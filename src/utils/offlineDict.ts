import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, Platform } from 'react-native';

let offlineDictCache: Record<string, any> | null = null;
export let offlineWordsListCache: BriefEntry[] = [];
export let offlineRootsListCache: BriefEntry[] = [];
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
  const cleanName = rawName.replace(/^-|-$/g, '').replace(/[\\\\/]/g, '_');
  if (cleanName.length === 0) return '_empty';
  if (cleanName.length === 1) return cleanName;
  return cleanName.substring(0, 2);
};

export const loadPartIntoMemory = async (prefix: string): Promise<Record<string, any> | null> => {
  if (loadedPartsCache[prefix]) return loadedPartsCache[prefix];
  const partPath = `${OFFLINE_PARTS_DIR}/${prefix}.json`;
  try {
    const exists = await RNFS.exists(partPath);
    let content = '';
    if (exists) {
      content = await RNFS.readFile(partPath, 'utf8');
    } else {
      if (Platform.OS === 'android') {
        content = await RNFS.readFileAssets(`dict_parts/${prefix}.json`, 'utf8');
      } else {
        content = await RNFS.readFile(`${RNFS.MainBundlePath}/dict_parts/${prefix}.json`, 'utf8');
      }
    }
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
    } else {
      offlineWordsPreviewCache = require('../assets/offline_words_preview.json');
      offlineRootsPreviewCache = require('../assets/offline_roots_preview.json');
    }
    return true;
  } catch (e) {
    console.error('Failed to load dictionary preview lists', e);
  }
  return false;
};

export const copyBuiltInDictToLocal = async (): Promise<boolean> => {
  // Built-in dictionary is now pre-sharded into Android assets, no need to copy large bin file.
  return true;
};

export const checkAndOptimizeOfflineDict = async (): Promise<void> => {
  try {
    const isOptimized = await AsyncStorage.getItem('@dict_optimized_v1');
    if (isOptimized === 'true') {
      return; 
    }

    // Built-in dictionary is now pre-sharded into Android assets.
    // We simply mark it as optimized to skip legacy runtime chunking.
    await AsyncStorage.setItem('@dict_optimized_v1', 'true');
    await loadOfflineListCacheIntoMemory();
    console.log('Offline dictionary optimization completed (pre-sharded assets).');
  } catch (e) {
    console.error('Background dictionary optimization failed:', e);
  }
};

export const hasOfflineDict = async (): Promise<boolean> => {
  // Built-in dictionary is now bundled via assets and require(), so it's always available.
  return true;
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
    } else {
      offlineWordsListCache = require('../assets/offline_words_index.json');
      offlineRootsListCache = require('../assets/offline_roots_index.json');
    }
    
    await loadOfflinePreviewsIntoMemory();

    isFullListLoaded = true;
    isFullListLoading = false;
    return true;
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
    
    const cacheKeys = Object.keys(offlineDictCache);
    for (let i = 0; i < cacheKeys.length; i++) {
      const key = cacheKeys[i];
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
      if (i % 2000 === 0) await new Promise(r => setTimeout(() => r(undefined), 1));
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
    const keys = Object.keys(parsed);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const prefix = getPrefix(key);
      if (!groups[prefix]) {
        groups[prefix] = {};
      }
      groups[prefix][key] = parsed[key];
      if (i % 2000 === 0) await new Promise(r => setTimeout(() => r(undefined), 1));
    }

    let fileCount = 0;
    for (const prefix in groups) {
      const partPath = `${OFFLINE_PARTS_DIR}/${prefix}.json`;
      await RNFS.writeFile(partPath, JSON.stringify(groups[prefix]), 'utf8');
      fileCount++;
      if (fileCount % 5 === 0) await new Promise(r => setTimeout(() => r(undefined), 1));
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

export const getAllOfflineWords = async (searchQuery: string = '', limit: number = 200, offset: number = 0, sortFilter: string = 'freq', contextFilter: string = 'all'): Promise<{items: BriefEntry[], total: number}> => {
  const cleanQuery = searchQuery.trim().toLowerCase();
  
  const loaded = await loadOfflineListCacheIntoMemory();
  if (!loaded) return { items: [], total: 0 };

  let filtered = offlineWordsListCache;

  if (contextFilter !== 'all') {
    // Attempt to load from storage or just ignore if not in offline dict.
    // In local mode, since offline DB doesn't have contexts, we just show all words for now.
    // A robust implementation would join with AsyncStorage.
  }

  if (cleanQuery) {
    filtered = filtered.filter(item => 
      item.title.toLowerCase().includes(cleanQuery) || item.meaning.includes(cleanQuery)
    );
  }

  filtered.sort((a, b) => {
    // If there is a search query, exact match takes precedence over everything
    if (cleanQuery) {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const aExact = aTitle === cleanQuery ? 1 : 0;
      const bExact = bTitle === cleanQuery ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      
      const aStarts = aTitle.startsWith(cleanQuery) ? 1 : 0;
      const bStarts = bTitle.startsWith(cleanQuery) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
    }

    if (sortFilter === 'az') {
      return a.title.localeCompare(b.title);
    }
    // freq sort: currently offline db doesn't store clicks, but normally we would sort by it.
    // We just fallback to A-Z for now, or keep it as is.
    return 0;
  });
  
  if (limit === -1) {
    return { items: filtered, total: filtered.length };
  }

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length
  };
};

export const getAllOfflineRoots = async (searchQuery: string = '', limit: number = 200, offset: number = 0, rootTypeFilter: string = 'all', contextFilter: string = 'all'): Promise<{items: BriefEntry[], total: number}> => {
  const cleanQuery = searchQuery.trim().toLowerCase();
  
  const loaded = await loadOfflineListCacheIntoMemory();
  if (!loaded) return { items: [], total: 0 };

  let filtered = offlineRootsListCache;

  if (contextFilter !== 'all') {
    // Attempt to load from storage or just ignore if not in offline dict.
    // In local mode, since offline DB doesn't have contexts, we just show all roots for now.
  }

  if (rootTypeFilter !== 'all') {
    filtered = filtered.filter((item) => {
      const type = (item.type || '').toLowerCase();
      const isPrefix = type.includes('前缀');
      const isRoot = type.includes('词根');
      const isSuffix = type.includes('后缀');
      const isComb = (isPrefix ? 1 : 0) + (isRoot ? 1 : 0) + (isSuffix ? 1 : 0) >= 2 || item.title.includes('+');

      if (rootTypeFilter === '组合') return isComb;
      if (rootTypeFilter === '前缀') return isPrefix && !isComb;
      if (rootTypeFilter === '词根') return isRoot && !isComb;
      if (rootTypeFilter === '后缀') return isSuffix && !isComb;
      if (rootTypeFilter === '其他') return !isPrefix && !isRoot && !isSuffix && !isComb;
      return false;
    });
  }

  if (cleanQuery) {
    filtered = filtered.filter(item => 
      item.title.toLowerCase().includes(cleanQuery) || item.meaning.includes(cleanQuery)
    );
  }

  if (cleanQuery) {
    filtered.sort((a, b) => {
      const aTitle = a.title.toLowerCase().replace(/^-|-$/g, '');
      const bTitle = b.title.toLowerCase().replace(/^-|-$/g, '');
      const aExact = aTitle === cleanQuery ? 1 : 0;
      const bExact = bTitle === cleanQuery ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      
      const aStarts = aTitle.startsWith(cleanQuery) ? 1 : 0;
      const bStarts = bTitle.startsWith(cleanQuery) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;

      return 0;
    });
  }
  
  if (limit === -1) {
    return { items: filtered, total: filtered.length };
  }

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length
  };
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
    rootEntry = await getEntryByKey(`R:${clean}`) || await getEntryByKey(`R:-${clean}`) || await getEntryByKey(`R:${clean}-`) || await getEntryByKey(`R:-${clean}-`);
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


