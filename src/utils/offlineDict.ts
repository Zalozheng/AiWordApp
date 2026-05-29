import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';

let offlineDictCache: Record<string, any> | null = null;
let offlineWordsListCache: BriefEntry[] = [];
let offlineRootsListCache: BriefEntry[] = [];
let offlineWordsPreviewCache: BriefEntry[] = [];
let offlineRootsPreviewCache: BriefEntry[] = [];
let isFullListLoaded = false;
let isFullListLoading = false;
const loadedPartsCache: Record<string, Record<string, any>> = {};

const OFFLINE_DICT_PATH = RNFS.DocumentDirectoryPath + '/offline_dict.json';
const OFFLINE_WORDS_INDEX_PATH = RNFS.DocumentDirectoryPath + '/offline_words_index.json';
const OFFLINE_ROOTS_INDEX_PATH = RNFS.DocumentDirectoryPath + '/offline_roots_index.json';
const OFFLINE_WORDS_PREVIEW_PATH = RNFS.DocumentDirectoryPath + '/offline_words_preview.json';
const OFFLINE_ROOTS_PREVIEW_PATH = RNFS.DocumentDirectoryPath + '/offline_roots_preview.json';
const OFFLINE_PARTS_DIR = RNFS.DocumentDirectoryPath + '/dict_parts';

export const getPrefix = (key: string): string => {
  // Key format is "W:apple" or "R:struct-" or similar.
  const rawName = key.substring(2).trim().toLowerCase();
  const cleanName = rawName.replace(/^-|-$/g, '');
  if (cleanName.length === 0) return '_empty';
  if (cleanName.length === 1) return cleanName;
  return cleanName.substring(0, 2);
};

export const loadPartIntoMemory = async (prefix: string): Promise<Record<string, any> | null> => {
  if (loadedPartsCache[prefix]) return loadedPartsCache[prefix];
  const partPath = `${OFFLINE_PARTS_DIR}/${prefix}.json`;
  try {
    const exists = await RNFS.exists(partPath);
    if (!exists) return null;
    const content = await RNFS.readFile(partPath, 'utf8');
    const parsed = JSON.parse(content);
    loadedPartsCache[prefix] = parsed;
    return parsed;
  } catch (e) {
    console.error(`Failed to load split dictionary part: ${prefix}`, e);
    return null;
  }
};

export const loadOfflinePreviewsIntoMemory = async (): Promise<boolean> => {
  if (offlineWordsPreviewCache.length > 0 && offlineRootsPreviewCache.length > 0) return true;
  try {
    const wExists = await RNFS.exists(OFFLINE_WORDS_PREVIEW_PATH);
    const rExists = await RNFS.exists(OFFLINE_ROOTS_PREVIEW_PATH);
    if (wExists && rExists) {
      const wContent = await RNFS.readFile(OFFLINE_WORDS_PREVIEW_PATH, 'utf8');
      const rContent = await RNFS.readFile(OFFLINE_ROOTS_PREVIEW_PATH, 'utf8');
      offlineWordsPreviewCache = JSON.parse(wContent);
      offlineRootsPreviewCache = JSON.parse(rContent);
      return true;
    }
  } catch (e) {
    console.error('Failed to load dictionary preview lists', e);
  }
  return false;
};

export const copyBuiltInDictToLocal = async (): Promise<boolean> => {
  try {
    const asset = require('../assets/word.bin');
    const source = Image.resolveAssetSource(asset);
    if (!source || !source.uri) {
      console.warn('Built-in dictionary asset source not found');
      return false;
    }

    console.log('Copying built-in dictionary from asset source:', source.uri);
    
    // Ensure parent directory exists
    const parentDir = OFFLINE_DICT_PATH.substring(0, OFFLINE_DICT_PATH.lastIndexOf('/'));
    const parentExists = await RNFS.exists(parentDir);
    if (!parentExists) {
      await RNFS.mkdir(parentDir);
    }

    if (source.uri.startsWith('http://') || source.uri.startsWith('https://')) {
      // Dev mode (Metro packager serving over HTTP)
      const downloadResult = await RNFS.downloadFile({
        fromUrl: source.uri,
        toFile: OFFLINE_DICT_PATH,
      }).promise;
      if (downloadResult.statusCode !== 200) {
        throw new Error(`Failed to download asset from Metro: status ${downloadResult.statusCode}`);
      }
    } else {
      // Production mode / Offline mode
      let localPath = source.uri;
      if (localPath.startsWith('file://')) {
        localPath = localPath.substring(7); // Remove file:// prefix
      }
      
      // On Android, assets in release build can be packed in APK assets.
      if (!localPath.startsWith('/') && !localPath.includes(':')) {
        console.log('Detecting Android release asset:', localPath);
        const possibleAssetPaths = [
          `custom/${localPath}.bin`,
          `${localPath}.bin`,
          `custom/src_assets_word.bin`,
          `src_assets_word.bin`
        ];
        
        let success = false;
        for (const assetPath of possibleAssetPaths) {
          try {
            console.log(`Trying to copy Android asset from: ${assetPath}`);
            const assetExists = await RNFS.existsAssets(assetPath);
            if (assetExists) {
              await RNFS.copyFileAssets(assetPath, OFFLINE_DICT_PATH);
              console.log(`Successfully copied from Android asset: ${assetPath}`);
              success = true;
              break;
            }
          } catch (e) {
            console.log(`Failed to copy from ${assetPath}:`, e);
          }
        }
        if (!success) {
          throw new Error(`Could not find or copy Android asset matching: ${localPath}`);
        }
      } else {
        // iOS or absolute file path
        console.log('Copying file from local path:', localPath);
        await RNFS.copyFile(localPath, OFFLINE_DICT_PATH);
      }
    }
    console.log('Successfully initialized offline dictionary from built-in asset!');
    return true;
  } catch (e) {
    console.error('Failed to copy built-in dictionary:', e);
    return false;
  }
};

export const checkAndOptimizeOfflineDict = async (): Promise<void> => {
  try {
    let dictExists = await RNFS.exists(OFFLINE_DICT_PATH);
    if (!dictExists) {
      console.log('Offline dictionary not found. Initializing from built-in asset...');
      const copied = await copyBuiltInDictToLocal();
      if (!copied) {
        console.warn('No built-in dictionary was initialized.');
        return;
      }
      dictExists = true;
    }

    const partsDirExists = await RNFS.exists(OFFLINE_PARTS_DIR);
    const previewExists = await RNFS.exists(OFFLINE_WORDS_PREVIEW_PATH);
    const isOptimized = await AsyncStorage.getItem('@dict_optimized_v1');

    if (partsDirExists && previewExists && isOptimized === 'true') {
      return; // Already sharded and previews generated
    }

    console.log('Starting offline dictionary sharding optimization...');
    const content = await RNFS.readFile(OFFLINE_DICT_PATH, 'utf8');
    const parsed = JSON.parse(content);

    if (await RNFS.exists(OFFLINE_PARTS_DIR)) {
      await RNFS.unlink(OFFLINE_PARTS_DIR);
    }
    await RNFS.mkdir(OFFLINE_PARTS_DIR);

    const groups: Record<string, Record<string, any>> = {};
    for (const key in parsed) {
      const prefix = getPrefix(key);
      if (!groups[prefix]) {
        groups[prefix] = {};
      }
      groups[prefix][key] = parsed[key];
    }

    for (const prefix in groups) {
      const partPath = `${OFFLINE_PARTS_DIR}/${prefix}.json`;
      await RNFS.writeFile(partPath, JSON.stringify(groups[prefix]), 'utf8');
    }

    await AsyncStorage.setItem('@dict_optimized_v1', 'true');
    await loadOfflineListCacheIntoMemory();
    console.log('Offline dictionary sharding optimization completed successfully!');
  } catch (e) {
    console.error('Background dictionary optimization failed:', e);
  }
};

export const hasOfflineDict = async (): Promise<boolean> => {
  return await RNFS.exists(OFFLINE_DICT_PATH);
};

export const loadOfflineDictIntoMemory = async (): Promise<boolean> => {
  if (offlineDictCache) return true;
  try {
    const exists = await RNFS.exists(OFFLINE_DICT_PATH);
    if (!exists) return false;
    const content = await RNFS.readFile(OFFLINE_DICT_PATH, 'utf8');
    offlineDictCache = JSON.parse(content);
    return true;
  } catch (e) {
    console.error('Failed to load offline dictionary details into memory', e);
    return false;
  }
};

export const loadOfflineListCacheIntoMemory = async (): Promise<boolean> => {
  if (isFullListLoaded) return true;
  if (isFullListLoading) return false;

  isFullListLoading = true;
  try {
    const wordsExists = await RNFS.exists(OFFLINE_WORDS_INDEX_PATH);
    const rootsExists = await RNFS.exists(OFFLINE_ROOTS_INDEX_PATH);
    if (wordsExists && rootsExists) {
      const wordsContent = await RNFS.readFile(OFFLINE_WORDS_INDEX_PATH, 'utf8');
      const rootsContent = await RNFS.readFile(OFFLINE_ROOTS_INDEX_PATH, 'utf8');
      offlineWordsListCache = JSON.parse(wordsContent);
      offlineRootsListCache = JSON.parse(rootsContent);
      
      const wPreviewExists = await RNFS.exists(OFFLINE_WORDS_PREVIEW_PATH);
      const rPreviewExists = await RNFS.exists(OFFLINE_ROOTS_PREVIEW_PATH);
      if (!wPreviewExists || !rPreviewExists) {
        const wordsPreview = offlineWordsListCache.slice(0, 200);
        const rootsPreview = offlineRootsListCache.slice(0, 200);
        await RNFS.writeFile(OFFLINE_WORDS_PREVIEW_PATH, JSON.stringify(wordsPreview), 'utf8');
        await RNFS.writeFile(OFFLINE_ROOTS_PREVIEW_PATH, JSON.stringify(rootsPreview), 'utf8');
        offlineWordsPreviewCache = wordsPreview;
        offlineRootsPreviewCache = rootsPreview;
      }

      isFullListLoaded = true;
      isFullListLoading = false;
      return true;
    }
  } catch (e) {
    console.error('Failed to load pre-computed lists, falling back to full dictionary parse', e);
  }

  // Fallback: load full dictionary, extract, sort, and save index files
  try {
    const exists = await RNFS.exists(OFFLINE_DICT_PATH);
    if (!exists) {
      isFullListLoading = false;
      return false;
    }
    
    const success = await loadOfflineDictIntoMemory();
    if (!success || !offlineDictCache) {
      isFullListLoading = false;
      return false;
    }

    const words: BriefEntry[] = [];
    const roots: BriefEntry[] = [];
    
    for (const key in offlineDictCache) {
      if (key.startsWith('W:')) {
        const entry = offlineDictCache[key];
        words.push({
          id: key,
          title: entry.word || key.substring(2),
          meaning: entry.primary_meaning || entry.meaning || '',
        });
      } else if (key.startsWith('R:')) {
        const entry = offlineDictCache[key];
        roots.push({
          id: key,
          title: entry.segment || key.substring(2),
          meaning: entry.meaning || '',
          type: entry.type || '词根',
        });
      }
    }
    
    words.sort((a, b) => a.title.localeCompare(b.title));
    roots.sort((a, b) => a.title.localeCompare(b.title));
    
    offlineWordsListCache = words;
    offlineRootsListCache = roots;

    // Cache to disk
    await RNFS.writeFile(OFFLINE_WORDS_INDEX_PATH, JSON.stringify(words), 'utf8');
    await RNFS.writeFile(OFFLINE_ROOTS_INDEX_PATH, JSON.stringify(roots), 'utf8');

    // Cache preview to disk (first 200 items)
    const wordsPreview = words.slice(0, 200);
    const rootsPreview = roots.slice(0, 200);
    await RNFS.writeFile(OFFLINE_WORDS_PREVIEW_PATH, JSON.stringify(wordsPreview), 'utf8');
    await RNFS.writeFile(OFFLINE_ROOTS_PREVIEW_PATH, JSON.stringify(rootsPreview), 'utf8');
    
    offlineWordsPreviewCache = wordsPreview;
    offlineRootsPreviewCache = rootsPreview;
    
    isFullListLoaded = true;
    isFullListLoading = false;
    return true;
  } catch (e) {
    console.error('Failed to parse full dictionary fallback', e);
    isFullListLoading = false;
    return false;
  }
};

export const getOfflineDictStats = async () => {
  const exists = await RNFS.exists(OFFLINE_DICT_PATH);
  if (!exists) return { exists: false, totalKeys: 0, sizeBytes: 0 };
  
  try {
    const stat = await RNFS.stat(OFFLINE_DICT_PATH);
    await loadOfflineListCacheIntoMemory();
    const totalKeys = offlineWordsListCache.length + offlineRootsListCache.length;
    return {
      exists: true,
      totalKeys,
      sizeBytes: stat.size,
    };
  } catch {
    return { exists: true, totalKeys: 0, sizeBytes: 0 };
  }
};

export const importOfflineDict = async (sourceUriOrPath: string): Promise<boolean> => {
  try {
    if (await RNFS.exists(OFFLINE_DICT_PATH)) {
      await RNFS.unlink(OFFLINE_DICT_PATH);
    }
    if (await RNFS.exists(OFFLINE_WORDS_INDEX_PATH)) {
      await RNFS.unlink(OFFLINE_WORDS_INDEX_PATH);
    }
    if (await RNFS.exists(OFFLINE_ROOTS_INDEX_PATH)) {
      await RNFS.unlink(OFFLINE_ROOTS_INDEX_PATH);
    }
    if (await RNFS.exists(OFFLINE_WORDS_PREVIEW_PATH)) {
      await RNFS.unlink(OFFLINE_WORDS_PREVIEW_PATH);
    }
    if (await RNFS.exists(OFFLINE_ROOTS_PREVIEW_PATH)) {
      await RNFS.unlink(OFFLINE_ROOTS_PREVIEW_PATH);
    }
    if (await RNFS.exists(OFFLINE_PARTS_DIR)) {
      await RNFS.unlink(OFFLINE_PARTS_DIR);
    }
    
    offlineDictCache = null;
    offlineWordsListCache = [];
    offlineRootsListCache = [];
    offlineWordsPreviewCache = [];
    offlineRootsPreviewCache = [];
    isFullListLoaded = false;
    isFullListLoading = false;
    for (const key in loadedPartsCache) {
      delete loadedPartsCache[key];
    }
    
    let content = await RNFS.readFile(sourceUriOrPath, 'utf8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid JSON format, must be an object map');
    }
    
    await RNFS.writeFile(OFFLINE_DICT_PATH, content, 'utf8');
    offlineDictCache = parsed;

    // Perform sharding split
    await RNFS.mkdir(OFFLINE_PARTS_DIR);
    const groups: Record<string, Record<string, any>> = {};
    for (const key in parsed) {
      const prefix = getPrefix(key);
      if (!groups[prefix]) {
        groups[prefix] = {};
      }
      groups[prefix][key] = parsed[key];
    }

    for (const prefix in groups) {
      const partPath = `${OFFLINE_PARTS_DIR}/${prefix}.json`;
      await RNFS.writeFile(partPath, JSON.stringify(groups[prefix]), 'utf8');
    }
    
    await AsyncStorage.setItem('@dict_optimized_v1', 'true');
    await loadOfflineListCacheIntoMemory();
    return true;
  } catch (e) {
    console.error('Failed to import offline dictionary', e);
    throw e;
  }
};

export const clearOfflineDict = async () => {
  try {
    if (await RNFS.exists(OFFLINE_DICT_PATH)) {
      await RNFS.unlink(OFFLINE_DICT_PATH);
    }
    if (await RNFS.exists(OFFLINE_WORDS_INDEX_PATH)) {
      await RNFS.unlink(OFFLINE_WORDS_INDEX_PATH);
    }
    if (await RNFS.exists(OFFLINE_ROOTS_INDEX_PATH)) {
      await RNFS.unlink(OFFLINE_ROOTS_INDEX_PATH);
    }
    if (await RNFS.exists(OFFLINE_WORDS_PREVIEW_PATH)) {
      await RNFS.unlink(OFFLINE_WORDS_PREVIEW_PATH);
    }
    if (await RNFS.exists(OFFLINE_ROOTS_PREVIEW_PATH)) {
      await RNFS.unlink(OFFLINE_ROOTS_PREVIEW_PATH);
    }
    if (await RNFS.exists(OFFLINE_PARTS_DIR)) {
      await RNFS.unlink(OFFLINE_PARTS_DIR);
    }
    
    offlineDictCache = null;
    offlineWordsListCache = [];
    offlineRootsListCache = [];
    offlineWordsPreviewCache = [];
    offlineRootsPreviewCache = [];
    isFullListLoaded = false;
    isFullListLoading = false;
    for (const key in loadedPartsCache) {
      delete loadedPartsCache[key];
    }
    
    await AsyncStorage.removeItem('@dict_optimized_v1');
    return true;
  } catch (e) {
    console.error('Failed to clear offline dict', e);
    return false;
  }
};

export interface OfflineQueryResult {
  word: string;
  display_breakdown: string;
  phonetic_us: string;
  primary_meaning: string;
  noun_source: string;
  parts: Array<{
    segment: string;
    type: string;
    meaning: string;
    deep_origin: string;
    derivatives: string[];
  }>;
  memory_lines: string[];
}

export const queryOfflineWord = async (word: string, contextMode: string = 'general'): Promise<OfflineQueryResult | null> => {
  const cleanWord = word.trim().toLowerCase();
  if (!cleanWord) return null;
  
  let entry = null;
  let isRoot = false;

  const getEntryByKey = async (key: string): Promise<any> => {
    const prefix = getPrefix(key);
    const part = await loadPartIntoMemory(prefix);
    if (part && part[key]) {
      return part[key];
    }
    const loaded = await loadOfflineDictIntoMemory();
    if (loaded && offlineDictCache) {
      return offlineDictCache[key];
    }
    return null;
  };
  
  // If it looks like a root query (starts or ends with hyphen)
  if (cleanWord.startsWith('-') || cleanWord.endsWith('-')) {
    const rootKey = `R:${cleanWord}`;
    entry = await getEntryByKey(rootKey);
    isRoot = true;
  }
  
  if (!entry) {
    // Try word key
    entry = await getEntryByKey(`W:${cleanWord}`);
  }
  
  if (!entry) {
    // Try root key directly
    entry = await getEntryByKey(`R:${cleanWord}`);
    if (entry) isRoot = true;
  }
  
  // Try cleaning hyphens if not found
  if (!entry && (cleanWord.startsWith('-') || cleanWord.endsWith('-'))) {
    const stripWord = cleanWord.replace(/^-|-$/g, '');
    entry = await getEntryByKey(`R:${stripWord}`) || await getEntryByKey(`W:${stripWord}`);
    if (entry && entry.id && entry.id.startsWith('R:')) isRoot = true;
  }
  
  if (!entry) return null;
  
  if (isRoot) {
    return {
      word: entry.segment || cleanWord,
      display_breakdown: entry.segment || cleanWord,
      phonetic_us: '',
      primary_meaning: entry.meaning || '',
      noun_source: '',
      parts: [{
        segment: entry.segment || cleanWord,
        type: entry.type || '词根/前缀/后缀',
        meaning: entry.meaning || '',
        deep_origin: entry.deep_origin || '',
        derivatives: entry.derivatives || [],
      }],
      memory_lines: [],
    };
  }
  
  // Resolve memory lines from memory_lines_map based on scenario/context mode
  let memoryLines: string[] = [];
  if (entry.memory_lines_map) {
    const map = entry.memory_lines_map;
    // Look for matching scenario engine keys (e.g. general, civ6, linux_ai, custom)
    const targetKey = Object.keys(map).find(
      key => key.endsWith(`_${contextMode}`) || key.includes(`_${contextMode}_`)
    );
    if (targetKey && map[targetKey]) {
      memoryLines = map[targetKey];
    } else {
      // Fallback: try first key, or general
      const fallbackKey = Object.keys(map).find(key => key.endsWith('_general')) || Object.keys(map)[0];
      if (fallbackKey && map[fallbackKey]) {
        memoryLines = map[fallbackKey];
      }
    }
  } else if (Array.isArray(entry.memory_lines)) {
    memoryLines = entry.memory_lines;
  }
  
  return {
    word: entry.word || cleanWord,
    display_breakdown: entry.display_breakdown || entry.word || cleanWord,
    phonetic_us: entry.phonetic_us || '',
    primary_meaning: entry.primary_meaning || entry.meaning || '',
    noun_source: entry.noun_source || '',
    parts: entry.parts || [],
    memory_lines: memoryLines,
  };
};

export interface BriefEntry {
  id: string;
  title: string;
  meaning: string;
  type?: string;
}

export const getAllOfflineWords = async (searchQuery: string = ''): Promise<BriefEntry[]> => {
  const cleanQuery = searchQuery.trim().toLowerCase();
  
  if (!cleanQuery) {
    const previewLoaded = await loadOfflinePreviewsIntoMemory();
    if (previewLoaded && offlineWordsPreviewCache.length > 0) {
      loadOfflineListCacheIntoMemory().catch(() => {});
      return offlineWordsPreviewCache;
    }
  }

  const loaded = await loadOfflineListCacheIntoMemory();
  if (!loaded) return [];

  if (!cleanQuery) {
    return offlineWordsListCache.slice(0, 200);
  }

  const results: BriefEntry[] = [];
  for (const item of offlineWordsListCache) {
    if (item.title.toLowerCase().includes(cleanQuery) || item.meaning.includes(cleanQuery)) {
      results.push(item);
      if (results.length >= 200) {
        break; // 提前截断，极大提升主线程渲染响应效率
      }
    }
  }
  
  return results;
};

export const getAllOfflineRoots = async (searchQuery: string = ''): Promise<BriefEntry[]> => {
  const cleanQuery = searchQuery.trim().toLowerCase();
  
  if (!cleanQuery) {
    const previewLoaded = await loadOfflinePreviewsIntoMemory();
    if (previewLoaded && offlineRootsPreviewCache.length > 0) {
      loadOfflineListCacheIntoMemory().catch(() => {});
      return offlineRootsPreviewCache;
    }
  }

  const loaded = await loadOfflineListCacheIntoMemory();
  if (!loaded) return [];

  if (!cleanQuery) {
    return offlineRootsListCache.slice(0, 200);
  }

  const results: BriefEntry[] = [];
  for (const item of offlineRootsListCache) {
    if (item.title.toLowerCase().includes(cleanQuery) || item.meaning.includes(cleanQuery)) {
      results.push(item);
      if (results.length >= 200) {
        break; // 提前终止
      }
    }
  }
  
  return results;
};


export interface WordTreeData {
  root: {
    segment: string;
    meaning: string;
    deep_origin: string;
  };
  derivatives: Array<{
    word: string;
    meaning: string;
  }>;
}

export const getWordTreeData = async (wordOrRoot: string): Promise<WordTreeData | null> => {
  const clean = wordOrRoot.trim().toLowerCase();
  if (!clean) return null;
  
  let rootEntry = null;
  let rootSegment = '';

  const getEntryByKey = async (key: string): Promise<any> => {
    const prefix = getPrefix(key);
    const part = await loadPartIntoMemory(prefix);
    if (part && part[key]) {
      return part[key];
    }
    const loaded = await loadOfflineDictIntoMemory();
    if (loaded && offlineDictCache) {
      return offlineDictCache[key];
    }
    return null;
  };
  
  // Case A: check root format segment directly
  if (clean.startsWith('-') || clean.endsWith('-') || await getEntryByKey(`R:${clean}`)) {
    const key = clean.startsWith('-') || clean.endsWith('-') ? `R:${clean}` : `R:${clean}`;
    rootEntry = await getEntryByKey(key);
    rootSegment = rootEntry?.segment || clean;
  }
  
  // Case B: word search, find its root parts
  if (!rootEntry) {
    const wordKey = `W:${clean}`;
    const wordEntry = await getEntryByKey(wordKey);
    if (wordEntry && wordEntry.parts && wordEntry.parts.length > 0) {
      const firstRootPart = wordEntry.parts.find((p: any) => p.type === '词根') || wordEntry.parts[0];
      if (firstRootPart && firstRootPart.segment) {
        rootSegment = firstRootPart.segment.trim().toLowerCase();
        rootEntry = await getEntryByKey(`R:${rootSegment}`) || await getEntryByKey(`R:-${rootSegment}`) || await getEntryByKey(`R:${rootSegment}-`) || firstRootPart;
      }
    }
  }
  
  if (!rootEntry) {
    rootEntry = await getEntryByKey(`R:${clean}`);
    if (rootEntry) {
      rootSegment = rootEntry.segment || clean;
    }
  }
  
  if (!rootEntry) return null;
  
  const derivativeList = rootEntry.derivatives || [];
  const derivatives: Array<{ word: string; meaning: string }> = [];
  
  for (const d of derivativeList) {
    const dWord = d.trim().toLowerCase();
    const dWordKey = `W:${dWord}`;
    const dEntry = await getEntryByKey(dWordKey);
    derivatives.push({
      word: d,
      meaning: dEntry ? (dEntry.primary_meaning || dEntry.meaning || '') : '暂无释义',
    });
  }
  
  return {
    root: {
      segment: rootEntry.segment || rootSegment,
      meaning: rootEntry.meaning || '',
      deep_origin: rootEntry.deep_origin || '',
    },
    derivatives,
  };
};


