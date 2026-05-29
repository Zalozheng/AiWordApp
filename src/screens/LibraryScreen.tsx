import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  useColorScheme,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Picker } from '@react-native-picker/picker';
import {
  hasOfflineDict,
  getAllOfflineWords,
  getAllOfflineRoots,
  queryOfflineWord,
  BriefEntry,
  WordTreeData,
} from '../utils/offlineDict';
import {
  getUnifiedWordTreeData,
  fetchLLMForWord,
} from '../utils/llmQuery';
import { LightTheme, DarkTheme } from '../utils/theme';
import { safeSetItem, safeGetItem } from '../utils/storage';

const LIBRARY_KEY = '@word_library';
const ROOT_LIBRARY_KEY = '@root_library';
const CACHE_KEY_PREFIX = '@word_cache_';
const FOLDERS_KEY = '@fav_folders';

const DEFAULT_FOLDERS = [
  { id: 'fav_default', name: '⭐ 默认收藏夹' }
];

const PAGE_SIZE = 20;

const LibraryScreen = ({ route, navigation }: any) => {
  // Tabs: 'words' (单词库), 'roots' (词根库), 'tree' (词树图谱)
  const [activeTab, setActiveTab] = useState('words');
  
  // Theme state
  const systemScheme = useColorScheme();
  const [uiTheme, setUiTheme] = useState('system');
  const activeTheme = uiTheme === 'system' ? (systemScheme || 'light') : uiTheme;
  const theme = activeTheme === 'dark' ? DarkTheme : LightTheme;
  const styles = getStyles(theme);
  
  // Folders list from settings
  const [folders, setFolders] = useState<any[]>(DEFAULT_FOLDERS);
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [activeStatus, setActiveStatus] = useState('all');

  // Word List Tab States
  const [wordSearchInput, setWordSearchInput] = useState('');
  const [wordSearch, setWordSearch] = useState('');
  const [wordsList, setWordsList] = useState<BriefEntry[]>([]);
  const [loadingWords, setLoadingWords] = useState(false);
  const [wordsPage, setWordsPage] = useState(1);
  const [totalWordsCount, setTotalWordsCount] = useState(0);
  const [wordSort, setWordSort] = useState<'time' | 'freq' | 'az'>('az');
  
  // Word Detail States
  const [editingMemoryLines, setEditingMemoryLines] = useState<string[]>([]);

  // Root List Tab States
  const [rootSearchInput, setRootSearchInput] = useState('');
  const [rootSearch, setRootSearch] = useState('');
  const [rootsList, setRootsList] = useState<BriefEntry[]>([]);
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [rootsPage, setRootsPage] = useState(1);
  const [totalRootsCount, setTotalRootsCount] = useState(0);
  const [rootSort, setRootSort] = useState<'time' | 'freq' | 'az'>('az');
  const [rootTypeFilter, setRootTypeFilter] = useState('all'); // 前缀/词根/后缀/组合/其他

  // Debouncing effect for search inputs
  useEffect(() => {
    const handler = setTimeout(() => {
      setWordSearch(wordSearchInput);
    }, 250);
    return () => clearTimeout(handler);
  }, [wordSearchInput]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setRootSearch(rootSearchInput);
    }, 250);
    return () => clearTimeout(handler);
  }, [rootSearchInput]);

  // Stack details history for back navigation
  const [detailHistory, setDetailHistory] = useState<any[]>([]);
  const currentDetail = detailHistory[detailHistory.length - 1] || null;
  const selectedWordDetail = currentDetail && currentDetail.type === 'word' ? currentDetail.data : null;
  const selectedRootDetail = currentDetail && currentDetail.type === 'root' ? currentDetail.data : null;

  const setSelectedWordDetail = (val: any) => {
    if (val === null) {
      setDetailHistory([]);
    } else {
      setDetailHistory(prev => {
        const item = { type: 'word', id: 'W:' + val.word?.toLowerCase(), title: val.word, data: val };
        if (prev.length > 0 && prev[prev.length - 1].type === 'word') {
          const copy = [...prev];
          copy[copy.length - 1] = item;
          return copy;
        }
        return [...prev, item];
      });
    }
  };

  const setSelectedRootDetail = (val: any) => {
    if (val === null) {
      setDetailHistory([]);
    } else {
      setDetailHistory(prev => {
        const segment = val.root?.segment || val.segment;
        const item = { type: 'root', id: 'R:' + segment?.toLowerCase().replace(/^-|-$/g, ''), title: segment, data: val };
        if (prev.length > 0 && prev[prev.length - 1].type === 'root') {
          const copy = [...prev];
          copy[copy.length - 1] = item;
          return copy;
        }
        return [...prev, item];
      });
    }
  };

  // Word Tree Tab States
  const [treeSearch, setTreeSearch] = useState('');
  const [treeData, setTreeData] = useState<WordTreeData | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);

  // Starred memory arrays
  const [starredWords, setStarredWords] = useState<any[]>([]);
  const [starredRoots, setStarredRoots] = useState<any[]>([]);

  // Dictionary check
  const [dictAvailable, setDictAvailable] = useState(false);

  const loadTheme = async () => {
    try {
      const themeVal = await AsyncStorage.getItem('ui_theme');
      if (themeVal) {
        setUiTheme(themeVal);
      }
    } catch (e) {
      console.error('Failed to load theme in LibraryScreen', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      checkDictAvailability();
      loadStarredData();
      loadTheme();
    }, [])
  );

  // Jump from outside parameters (HomeScreen or notifications)
  useEffect(() => {
    if (route?.params?.activeTab) {
      setActiveTab(route.params.activeTab);
    }
    if (route?.params?.initialWord) {
      setTreeSearch(route.params.initialWord);
      generateTree(route.params.initialWord);
    }
  }, [route?.params]);



  // Sync edit memory lines when word details load
  useEffect(() => {
    if (selectedWordDetail) {
      setEditingMemoryLines(selectedWordDetail.memory_lines || []);
    } else {
      setEditingMemoryLines([]);
    }
  }, [selectedWordDetail]);

  const checkDictAvailability = async () => {
    const isAvailable = await hasOfflineDict();
    setDictAvailable(isAvailable);
  };

  const loadStarredData = async () => {
    try {
      // 1. Starred Words
      const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
      if (wordsStr) {
        setStarredWords(JSON.parse(wordsStr));
      } else {
        setStarredWords([]);
      }

      // 2. Starred Roots
      const rootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
      if (rootsStr) {
        setStarredRoots(JSON.parse(rootsStr));
      } else {
        setStarredRoots([]);
      }

      // 3. Custom folders
      const fStr = await AsyncStorage.getItem(FOLDERS_KEY);
      if (fStr) {
        setFolders(JSON.parse(fStr));
      } else {
        setFolders(DEFAULT_FOLDERS);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // --- Words Data Query & Filter ---
  const loadWordsData = useCallback(async () => {
    if (!dictAvailable) {
      setWordsList([]);
      setTotalWordsCount(0);
      return;
    }

    setLoadingWords(true);
    try {
      let filtered: BriefEntry[] = [];
      filtered = await getAllOfflineWords(wordSearch);

      // Sort
      if (wordSort === 'az') {
        filtered.sort((a, b) => a.title.localeCompare(b.title));
      } else if (wordSort === 'time') {
        filtered.reverse();
      }

      setTotalWordsCount(filtered.length);
      const startIdx = (wordsPage - 1) * PAGE_SIZE;
      const paginated = filtered.slice(startIdx, startIdx + PAGE_SIZE);
      setWordsList(paginated);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingWords(false);
    }
  }, [dictAvailable, wordSearch, wordSort, wordsPage]);

  // --- Roots Data Query & Filter ---
  const loadRootsData = useCallback(async () => {
    if (!dictAvailable) {
      setRootsList([]);
      setTotalRootsCount(0);
      return;
    }

    setLoadingRoots(true);
    try {
      let filtered: BriefEntry[] = [];
      filtered = await getAllOfflineRoots(rootSearch);
      
      // Filter by Root Type (Prefix / Suffix / Root / Combination)
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
          return false;
        });
      }

      // Sort
      if (rootSort === 'az') {
        filtered.sort((a, b) => a.title.localeCompare(b.title));
      } else if (rootSort === 'time') {
        filtered.reverse();
      }

      setTotalRootsCount(filtered.length);
      const startIdx = (rootsPage - 1) * PAGE_SIZE;
      const paginated = filtered.slice(startIdx, startIdx + PAGE_SIZE);
      setRootsList(paginated);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRoots(false);
    }
  }, [dictAvailable, rootSearch, rootTypeFilter, rootSort, rootsPage]);

  // Load words when filters, search or range changes
  useEffect(() => {
    if (activeTab === 'words') {
      loadWordsData();
    }
  }, [activeTab, loadWordsData]);

  // Load roots when filters, search or range changes
  useEffect(() => {
    if (activeTab === 'roots') {
      loadRootsData();
    }
  }, [activeTab, loadRootsData]);

  // --- Word Details View ---
  const viewWordDetail = async (wordEntry: BriefEntry) => {
    setLoadingWords(true);
    const cleanWord = wordEntry.title.trim().toLowerCase();
    try {
      // 1. Try AsyncStorage W: schema first
      const cachedStr = await AsyncStorage.getItem('W:' + cleanWord);
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr);
        setDetailHistory(prev => [...prev, { type: 'word', id: 'W:' + cleanWord, title: parsed.word || cleanWord, data: parsed }]);
        return;
      }

      // 2. Try starredWords matches
      const starredMatch = starredWords.find(
        (w) => w.word.toLowerCase() === cleanWord
      );
      if (starredMatch) {
        setDetailHistory(prev => [...prev, { type: 'word', id: 'W:' + cleanWord, title: starredMatch.word, data: starredMatch }]);
        return;
      }

      // 3. Try queryOfflineWord
      const offlineResult = await queryOfflineWord(cleanWord);
      if (offlineResult) {
        setDetailHistory(prev => [...prev, { type: 'word', id: 'W:' + cleanWord, title: offlineResult.word, data: offlineResult }]);
        return;
      }

      // 4. Try Online LLM Fallback (using fetchLLMForWord if settings allow)
      const settingsStr = await AsyncStorage.getItem('@app_settings');
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      if (settings.apiKey) {
        const onlineResult = await fetchLLMForWord(cleanWord, false, 'api', settings.promptContext || 'general');
        setDetailHistory(prev => [...prev, { type: 'word', id: 'W:' + cleanWord, title: onlineResult.word, data: onlineResult }]);
        return;
      }

      // 5. Default fallback
      const defaultObj = {
        word: wordEntry.title,
        display_breakdown: wordEntry.title,
        phonetic_us: '',
        primary_meaning: wordEntry.meaning || '未收录 (请配置 API 进行在线查词)',
        noun_source: '',
        parts: [],
        memory_lines: [],
      };
      setDetailHistory(prev => [...prev, { type: 'word', id: 'W:' + cleanWord, title: wordEntry.title, data: defaultObj }]);
    } catch (e: any) {
      Alert.alert('加载详情失败', e.message || '网络或数据错误');
    } finally {
      setLoadingWords(false);
    }
  };

  // --- Root Details View ---
  const viewRootDetail = async (rootId: string) => {
    setLoadingRoots(true);
    const cleanSegment = rootId.replace(/^R:/, '').toLowerCase().replace(/^-|-$/g, '').trim();
    try {
      // 1. Try getUnifiedWordTreeData (which queries both AsyncStorage and offline)
      const data = await getUnifiedWordTreeData(cleanSegment);
      if (data) {
        // Retrieve custom root metadata if exists
        const rootKey = 'R:' + cleanSegment;
        const cachedRootStr = await AsyncStorage.getItem(rootKey);
        if (cachedRootStr) {
          const parsedRoot = JSON.parse(cachedRootStr);
          data.root = {
            ...data.root,
            ...parsedRoot,
          };
        }
        setDetailHistory(prev => [...prev, { type: 'root', id: 'R:' + cleanSegment, title: data.root.segment || cleanSegment, data }]);
        return;
      }

      // 2. Default fallback
      const defaultData = {
        root: {
          segment: cleanSegment,
          meaning: '未收录',
          deep_origin: '暂无记录',
        },
        derivatives: [],
      };
      setDetailHistory(prev => [...prev, { type: 'root', id: 'R:' + cleanSegment, title: cleanSegment, data: defaultData }]);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingRoots(false);
    }
  };

  // --- Starred / Library Database Actions ---
  const saveWordToLibrary = async (wordObj: any) => {
    try {
      const cleanWord = wordObj.word.toLowerCase();
      // 1. Save to starred list array
      const updated = starredWords.filter(
        (w) => w.word.toLowerCase() !== cleanWord
      );
      updated.unshift(wordObj);
      setStarredWords(updated);
      await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));

      // 2. Save directly to unified W: key
      await safeSetItem('W:' + cleanWord, JSON.stringify(wordObj));
    } catch (e) {
      console.error(e);
    }
  };

  const removeWordFromLibrary = async (word: string) => {
    try {
      const cleanWord = word.toLowerCase();
      // 1. Remove from starred list array
      const updated = starredWords.filter((w) => w.word.toLowerCase() !== cleanWord);
      setStarredWords(updated);
      await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));

      // 2. Update unified W: key by removing favorites flags
      const cachedStr = await AsyncStorage.getItem('W:' + cleanWord);
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr);
        parsed.is_favorite = false;
        parsed.favorite_folder_ids = [];
        parsed.favorite_folder_id = null;
        await safeSetItem('W:' + cleanWord, JSON.stringify(parsed));
      }
      Alert.alert('已移出特训库');
    } catch (e) {
      console.error(e);
    }
  };

  const saveRootToLibrary = async (rootObj: any) => {
    try {
      const cleanSegment = rootObj.segment.toLowerCase().replace(/^-|-$/g, '');
      // 1. Save to starred list array
      const updated = starredRoots.filter(
        (r) => r.segment.toLowerCase().replace(/^-|-$/g, '') !== cleanSegment
      );
      updated.unshift(rootObj);
      setStarredRoots(updated);
      await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(updated));

      // 2. Save directly to unified R: key
      await safeSetItem('R:' + cleanSegment, JSON.stringify(rootObj));
    } catch (e) {
      console.error(e);
    }
  };

  const removeRootFromLibrary = async (segment: string) => {
    try {
      const cleanSegment = segment.toLowerCase().replace(/^-|-$/g, '');
      // 1. Remove from starred list array
      const updated = starredRoots.filter(
        (r) => r.segment.toLowerCase().replace(/^-|-$/g, '') !== cleanSegment
      );
      setStarredRoots(updated);
      await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(updated));

      // 2. Update unified R: key by removing favorites flags
      const cachedStr = await AsyncStorage.getItem('R:' + cleanSegment);
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr);
        parsed.is_favorite = false;
        parsed.favorite_folder_ids = [];
        parsed.favorite_folder_id = null;
        await safeSetItem('R:' + cleanSegment, JSON.stringify(parsed));
      }
      Alert.alert('已移出词根特训库');
    } catch (e) {
      console.error(e);
    }
  };

  // --- Detail Option Toggles ---
  const toggleStarInWordDetail = async (wordObj: any) => {
    const isStarred = starredWords.some((w) => w.word.toLowerCase() === wordObj.word.toLowerCase());
    if (isStarred) {
      await removeWordFromLibrary(wordObj.word);
    } else {
      const newStarred = {
        word: wordObj.word,
        display_breakdown: wordObj.display_breakdown || wordObj.word,
        phonetic_us: wordObj.phonetic_us || '',
        primary_meaning: wordObj.primary_meaning || '',
        noun_source: wordObj.noun_source || '',
        parts: wordObj.parts || [],
        memory_lines: wordObj.memory_lines || [],
        learning_status: wordObj.learning_status || '',
        favorite_folder_ids: wordObj.favorite_folder_ids || [],
      };
      await saveWordToLibrary(newStarred);
      setSelectedWordDetail(newStarred);
      Alert.alert('已加入特训库');
    }
  };

  const toggleStarInRootDetail = async (rootObj: any) => {
    const cleanSeg = rootObj.segment.toLowerCase().replace(/^-|-$/g, '');
    const isStarred = starredRoots.some((r) => r.segment.toLowerCase().replace(/^-|-$/g, '') === cleanSeg);
    if (isStarred) {
      await removeRootFromLibrary(rootObj.segment);
      setSelectedRootDetail({
        ...selectedRootDetail,
        root: {
          ...selectedRootDetail.root,
          learning_status: '',
          favorite_folder_ids: [],
        }
      });
    } else {
      const newStarred = {
        segment: rootObj.segment,
        meaning: rootObj.meaning || '',
        deep_origin: rootObj.deep_origin || '',
        type: rootObj.type || '词根',
        derivatives: selectedRootDetail.derivatives?.map((d: any) => d.word) || [],
        learning_status: rootObj.learning_status || '',
        favorite_folder_ids: rootObj.favorite_folder_ids || [],
        manual_category: rootObj.manual_category || '',
      };
      await saveRootToLibrary(newStarred);
      setSelectedRootDetail({
        ...selectedRootDetail,
        root: newStarred
      });
      Alert.alert('已加入词根特训库');
    }
  };

  const updateWordLearningStatus = async (status: 'learned' | 'review' | '') => {
    if (!selectedWordDetail) return;
    const updated = {
      ...selectedWordDetail,
      learning_status: status,
    };
    setSelectedWordDetail(updated);
    await saveWordToLibrary(updated);
  };

  const updateRootLearningStatus = async (status: 'learned' | 'review' | '') => {
    if (!selectedRootDetail) return;
    const updatedRoot = {
      ...selectedRootDetail.root,
      learning_status: status,
    };
    setSelectedRootDetail({
      ...selectedRootDetail,
      root: updatedRoot,
    });
    await saveRootToLibrary(updatedRoot);
  };

  const toggleFolderInWord = async (folderId: string) => {
    if (!selectedWordDetail) return;
    const currentIds = selectedWordDetail.favorite_folder_ids || [];
    let newIds = [];
    if (currentIds.includes(folderId)) {
      newIds = currentIds.filter((id: string) => id !== folderId);
    } else {
      newIds = [...currentIds, folderId];
    }

    const updated = {
      ...selectedWordDetail,
      favorite_folder_ids: newIds,
    };
    setSelectedWordDetail(updated);
    await saveWordToLibrary(updated);
  };

  const toggleFolderInRoot = async (folderId: string) => {
    if (!selectedRootDetail) return;
    const currentIds = selectedRootDetail.root.favorite_folder_ids || [];
    let newIds = [];
    if (currentIds.includes(folderId)) {
      newIds = currentIds.filter((id: string) => id !== folderId);
    } else {
      newIds = [...currentIds, folderId];
    }

    const updatedRoot = {
      ...selectedRootDetail.root,
      favorite_folder_ids: newIds,
    };
    setSelectedRootDetail({
      ...selectedRootDetail,
      root: updatedRoot,
    });
    await saveRootToLibrary(updatedRoot);
  };

  const updateRootManualCategory = async (category: string) => {
    if (!selectedRootDetail) return;
    const updatedRoot = {
      ...selectedRootDetail.root,
      manual_category: category,
    };
    setSelectedRootDetail({
      ...selectedRootDetail,
      root: updatedRoot,
    });
    await saveRootToLibrary(updatedRoot);
  };

  const saveCustomMemoryLines = async () => {
    if (!selectedWordDetail) return;
    try {
      const cleanWord = selectedWordDetail.word.toLowerCase().trim();
      const settingsStr = await AsyncStorage.getItem('@app_settings');
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      const currentContext = settings.promptContext || 'general';
      const mapKey = 'remote_' + currentContext;
      
      const lines = editingMemoryLines.filter(l => l.trim().length > 0);
      
      const updated = {
        ...selectedWordDetail,
        memory_lines: lines,
      };
      
      if (!updated.memory_lines_map) {
        updated.memory_lines_map = {};
      }
      updated.memory_lines_map[mapKey] = lines;
      
      if (!updated.edited_keys) {
        updated.edited_keys = [];
      }
      if (!updated.edited_keys.includes(mapKey)) {
        updated.edited_keys.push(mapKey);
      }
      
      setSelectedWordDetail(updated);
      await saveWordToLibrary(updated);
      Alert.alert('提示', '记忆联想修改成功！');
    } catch (e: any) {
      Alert.alert('错误', '保存记忆法失败: ' + e.message);
    }
  };

  // --- Word Tree Graph Generation ---
  const generateTree = async (keyword: string) => {
    if (!keyword.trim()) return;
    setLoadingTree(true);
    const cleanKeyword = keyword.trim().toLowerCase();
    try {
      // 1. Try unified word tree search (checks AsyncStorage and offline dict)
      let data = await getUnifiedWordTreeData(cleanKeyword);
      if (data) {
        setTreeData(data);
        return;
      }

      // 2. If not found in offline/cache, check if API config is available to search online
      const settingsStr = await AsyncStorage.getItem('@app_settings');
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      if (settings.apiKey) {
        await fetchLLMForWord(cleanKeyword, false, 'api', settings.promptContext || 'general');
        data = await getUnifiedWordTreeData(cleanKeyword);
        if (data) {
          setTreeData(data);
          return;
        }
      }

      // 3. Fallback
      setTreeData(null);
      Alert.alert('提示', `未包含「${keyword}」的词根派生映射树，且未配置 API 在线解析。`);
    } catch (e: any) {
      setTreeData(null);
      Alert.alert('生成图谱失败', e.message || '网络或数据解析错误');
    } finally {
      setLoadingTree(false);
    }
  };

  // Play sound pronunciation
  const playPhoneticSound = (text: string) => {
    try {
      const globalAny = globalThis as any;
      if (typeof globalAny.speechSynthesis !== 'undefined') {
        globalAny.speechSynthesis.cancel();
        const utterance = new globalAny.SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        globalAny.speechSynthesis.speak(utterance);
      } else {
        Alert.alert('语音朗读', `🔊 [发音]: ${text}`);
      }
    } catch {
      Alert.alert('语音朗读', `🔊 [发音]: ${text}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBar} backgroundColor={theme.cardBg} />
      {/* Top Main View Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'words' && styles.activeTabButton]}
          onPress={() => { setSelectedWordDetail(null); setSelectedRootDetail(null); setActiveTab('words'); }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'words' && styles.activeTabButtonText]}>📖 单词库</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'roots' && styles.activeTabButton]}
          onPress={() => { setSelectedWordDetail(null); setSelectedRootDetail(null); setActiveTab('roots'); }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'roots' && styles.activeTabButtonText]}>🌱 词根库</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'tree' && styles.activeTabButton]}
          onPress={() => { setSelectedWordDetail(null); setSelectedRootDetail(null); setActiveTab('tree'); }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'tree' && styles.activeTabButtonText]}>🌳 词树图</Text>
        </TouchableOpacity>
      </View>

      {/* ---------------- 📖 WORD LIBRARY TAB ---------------- */}
      {activeTab === 'words' && (
        <View style={styles.tabBody}>
          {selectedWordDetail ? (
            /* Fixed Header Detail view for Words */
            <View style={{ flex: 1 }}>
              <View style={styles.fixedDetailHeader}>
                <TouchableOpacity style={styles.fixedBackBtn} onPress={() => setDetailHistory(prev => prev.slice(0, -1))}>
                  <Icon name="chevron-back" size={24} color={theme.primary} />
                  <Text style={styles.fixedBackBtnText}>{detailHistory.length > 1 ? `返回: ${detailHistory[detailHistory.length - 2].title}` : '返回列表'}</Text>
                </TouchableOpacity>
                <Text style={styles.fixedHeaderTitle} numberOfLines={1}>{selectedWordDetail.word}</Text>
                <View style={{ width: 80 }} />
              </View>

              <ScrollView style={styles.detailCard} showsVerticalScrollIndicator={false}>
                <View style={styles.detailTitleBox}>
                  <Text style={styles.detailWordTitle}>{selectedWordDetail.word}</Text>
                  <TouchableOpacity onPress={() => playPhoneticSound(selectedWordDetail.word)} style={styles.volumeIcon}>
                    <Icon name="volume-high" size={22} color={theme.primary} />
                  </TouchableOpacity>
                  {selectedWordDetail.phonetic_us ? (
                    <Text style={styles.detailPhonetic}>/{selectedWordDetail.phonetic_us}/</Text>
                  ) : null}
                </View>
                <Text style={styles.detailMeaning}>{selectedWordDetail.primary_meaning}</Text>
                {selectedWordDetail.noun_source ? (
                  <Text style={styles.detailCoreMeaning}>🎯 名词源追溯：{selectedWordDetail.noun_source}</Text>
                ) : null}

                {/* Edit Memory Lines */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>💡 情境联想 (可编辑修改)：</Text>
                  {editingMemoryLines.map((line, idx) => (
                    <View key={idx} style={styles.editableMemoryLineItem}>
                      <Text style={styles.detailMemoryBullet}>•</Text>
                      <TextInput
                        style={styles.editableMemoryInput}
                        value={line}
                        onChangeText={(text) => {
                          const copy = [...editingMemoryLines];
                          copy[idx] = text;
                          setEditingMemoryLines(copy);
                        }}
                        multiline
                      />
                    </View>
                  ))}
                  {editingMemoryLines.length > 0 && (
                    <TouchableOpacity style={styles.saveMemoryLinesBtn} onPress={saveCustomMemoryLines}>
                      <Text style={styles.saveMemoryLinesBtnText}>💾 保存自定义联想</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Sub Parts breakdown */}
                {selectedWordDetail.parts && selectedWordDetail.parts.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>🌿 词根/拆解部件 (点击跳转词根库)：</Text>
                    {selectedWordDetail.parts.map((part: any, index: number) => (
                      <TouchableOpacity 
                        key={index} 
                        style={styles.detailPartRow}
                        onPress={() => {
                          setActiveTab('roots');
                          viewRootDetail(`R:${part.segment.replace(/^-|-$/g, '')}`);
                        }}
                      >
                        <View style={styles.detailSegmentBox}>
                          <Text style={styles.detailSegmentText}>{part.segment}</Text>
                          <Text style={styles.detailSegmentType}>{part.type}</Text>
                        </View>
                        <View style={styles.detailSegmentDetail}>
                          <Text style={styles.detailSegmentMeaning}>{part.meaning}</Text>
                          <Text style={styles.detailSegmentOrigin} numberOfLines={3}>{part.deep_origin}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Bottom Action Triggers */}
                <View style={styles.detailActionRow}>
                  <TouchableOpacity 
                    style={styles.detailActionBtn}
                    onPress={() => toggleStarInWordDetail(selectedWordDetail)}
                  >
                    <Text style={styles.detailActionBtnText}>
                      {starredWords.some(item => item.word.toLowerCase() === selectedWordDetail.word.toLowerCase()) ? '⭐ 取消收藏' : '★ 收藏'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, { borderColor: theme.primary, backgroundColor: theme.primaryLight, marginLeft: 12 }]}
                    onPress={() => {
                      navigation.navigate('Favorites');
                    }}
                  >
                    <Text style={[styles.detailActionBtnText, { color: theme.primaryText }]}>🃏 去收藏夹特训</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, { borderColor: theme.success, backgroundColor: theme.successLight, marginLeft: 12 }]}
                    onPress={() => {
                      const w = selectedWordDetail.word;
                      setDetailHistory([]);
                      setActiveTab('tree');
                      setTreeSearch(w);
                      generateTree(w);
                    }}
                  >
                    <Text style={[styles.detailActionBtnText, { color: theme.successText }]}>🌳 记忆树</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          ) : (
            /* Word List View */
            <>
              {/* Filtering Toolbar */}
              <View style={styles.searchBarWrapper}>
                <Icon name="search" size={20} color="#94a3b8" style={styles.searchBarIcon} />
                <TextInput
                  style={styles.searchBarInput}
                  placeholder="检索离线词典..."
                  value={wordSearchInput}
                  onChangeText={(text) => { setWordSearchInput(text); setWordsPage(1); }}
                  autoCapitalize="none"
                />
                {wordSearchInput ? (
                  <TouchableOpacity onPress={() => { setWordSearchInput(''); setWordsPage(1); }}>
                    <Icon name="close-circle" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Sorted bar and Page stats */}
              <View style={styles.listStatsBar}>
                <Text style={styles.listStatsText}>📊 检索数量: {totalWordsCount}</Text>
                <View style={styles.sortPickerWrapper}>
                  <Picker
                    selectedValue={wordSort}
                    style={styles.sortPicker}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => setWordSort(val)}
                  >
                    <Picker.Item label="A-Z 排序" value="az" />
                    <Picker.Item label="最近更新" value="time" />
                  </Picker>
                </View>
              </View>

              {/* Loading Indicator */}
              {loadingWords ? (
                <ActivityIndicator style={{ marginTop: 40 }} size="large" color={theme.primary} />
              ) : (
                <View style={{ flex: 1 }}>
                  <FlatList
                    data={wordsList}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => {
                      const cleanWord = item.title;
                      const hasStarred = starredWords.some(w => w.word.toLowerCase() === cleanWord.toLowerCase());
                      return (
                        <TouchableOpacity style={styles.wordItem} onPress={() => viewWordDetail(item)}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={styles.wordText}>{item.title}</Text>
                              {hasStarred && <Text style={styles.starBadgeIcon}>★</Text>}
                            </View>
                            <Text style={styles.meaningText} numberOfLines={1}>{item.meaning}</Text>
                          </View>
                          <Icon name="chevron-forward" size={18} color="#cbd5e1" />
                        </TouchableOpacity>
                      );
                    }}
                    ListEmptyComponent={
                      <View style={styles.emptyContainer}>
                        <Icon name="book-outline" size={50} color="#94a3b8" />
                        <Text style={styles.emptyText}>无匹配单词结果</Text>
                      </View>
                    }
                  />

                  {/* Pagination Controls */}
                  {totalWordsCount > PAGE_SIZE && (
                    <View style={styles.paginationRow}>
                      <TouchableOpacity
                        style={[styles.pageBtn, wordsPage === 1 && styles.pageBtnDisabled]}
                        disabled={wordsPage === 1}
                        onPress={() => setWordsPage(wordsPage - 1)}
                      >
                        <Text style={styles.pageBtnText}>上一页</Text>
                      </TouchableOpacity>
                      <Text style={styles.pageIndicator}>页码: {wordsPage} / {Math.ceil(totalWordsCount / PAGE_SIZE)}</Text>
                      <TouchableOpacity
                        style={[styles.pageBtn, wordsPage * PAGE_SIZE >= totalWordsCount && styles.pageBtnDisabled]}
                        disabled={wordsPage * PAGE_SIZE >= totalWordsCount}
                        onPress={() => setWordsPage(wordsPage + 1)}
                      >
                        <Text style={styles.pageBtnText}>下一页</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* ---------------- 🌱 ROOT LIBRARY TAB ---------------- */}
      {activeTab === 'roots' && (
        <View style={styles.tabBody}>
          {selectedRootDetail ? (
            /* Fixed Header Detail view for Roots */
            <View style={{ flex: 1 }}>
              <View style={styles.fixedDetailHeader}>
                <TouchableOpacity style={styles.fixedBackBtn} onPress={() => setDetailHistory(prev => prev.slice(0, -1))}>
                  <Icon name="chevron-back" size={24} color={theme.primary} />
                  <Text style={styles.fixedBackBtnText}>{detailHistory.length > 1 ? `返回: ${detailHistory[detailHistory.length - 2].title}` : '返回列表'}</Text>
                </TouchableOpacity>
                <Text style={styles.fixedHeaderTitle} numberOfLines={1}>{selectedRootDetail.root.segment}</Text>
                <View style={{ width: 80 }} />
              </View>

              <ScrollView style={styles.rootDetailCard} showsVerticalScrollIndicator={false}>
                <View style={styles.rootDetailHeader}>
                  <Text style={styles.rootDetailTitle}>{selectedRootDetail.root.segment}</Text>
                  <Text style={styles.rootDetailType}>{selectedRootDetail.root.manual_category || selectedRootDetail.root.type || '词根'}</Text>
                </View>
                
                <Text style={styles.rootDetailMeaning}>🎯 核心义：{selectedRootDetail.root.meaning || '暂无释义'}</Text>

                {/* Manual Type Override Selector */}
                <View style={styles.metaSelectorsBox}>
                  <Text style={styles.metaLabel}>手动归正分类：</Text>
                  <View style={styles.pickerWrapperBorder}>
                    <Picker
                      selectedValue={selectedRootDetail.root.manual_category || ''}
                      style={{ height: 50, color: theme.text }}
                      dropdownIconColor={theme.primary}
                      onValueChange={(val) => updateRootManualCategory(val)}
                    >
                      <Picker.Item label="⚙️ 自动分配类型" value="" />
                      <Picker.Item label="📌 归为: 前缀" value="前缀" />
                      <Picker.Item label="🌱 归为: 词根" value="词根" />
                      <Picker.Item label="🪝 归为: 后缀" value="后缀" />
                      <Picker.Item label="🧩 归为: 组合" value="组合" />
                      <Picker.Item label="📦 归为: 其他" value="其他" />
                    </Picker>
                  </View>
                </View>

                {/* History origins */}
                {selectedRootDetail.root.deep_origin ? (
                  <View style={styles.rootDetailSection}>
                    <Text style={styles.rootDetailSectionTitle}>📖 渊源与历史演变：</Text>
                    <Text style={styles.rootDetailBody}>{selectedRootDetail.root.deep_origin}</Text>
                  </View>
                ) : null}

                {/* Derivatives Grid list */}
                <View style={styles.rootDetailSection}>
                  <Text style={styles.rootDetailSectionTitle}>🌿 同根派生出的衍生词 ({selectedRootDetail.derivatives?.length || 0} 词)：</Text>
                  <View style={styles.derivGrid}>
                    {selectedRootDetail.derivatives?.map((d: any, dIdx: number) => (
                      <TouchableOpacity
                        key={dIdx}
                        style={styles.derivTagCard}
                        onPress={() => {
                          setActiveTab('words');
                          viewWordDetail({ id: `W:${d.word}`, title: d.word, meaning: d.meaning });
                        }}
                      >
                        <Text style={styles.derivTagWord}>{d.word}</Text>
                        <Text style={styles.derivTagMeaning} numberOfLines={1}>{d.meaning}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Bottom triggers */}
                <View style={styles.detailActionRow}>
                  <TouchableOpacity 
                    style={styles.detailActionBtn}
                    onPress={() => toggleStarInRootDetail(selectedRootDetail.root)}
                  >
                    <Text style={styles.detailActionBtnText}>
                      {starredRoots.some(item => item.segment.toLowerCase().replace(/^-|-$/g, '') === selectedRootDetail.root.segment.toLowerCase().replace(/^-|-$/g, '')) ? '⭐ 取消收藏' : '★ 收藏'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, { borderColor: theme.primary, backgroundColor: theme.primaryLight, marginLeft: 12 }]}
                    onPress={() => {
                      navigation.navigate('Favorites');
                    }}
                  >
                    <Text style={[styles.detailActionBtnText, { color: theme.primaryText }]}>🃏 去收藏夹特训</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.detailActionBtn, { borderColor: theme.success, backgroundColor: theme.successLight, marginLeft: 12 }]}
                    onPress={() => {
                      const seg = selectedRootDetail.root.segment;
                      setDetailHistory([]);
                      setActiveTab('tree');
                      setTreeSearch(seg);
                      generateTree(seg);
                    }}
                  >
                    <Text style={[styles.detailActionBtnText, { color: theme.successText }]}>🌳 派生树</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          ) : (
            /* Root List View */
            <>
              {/* Filtering Toolbar */}
              <View style={styles.searchBarWrapper}>
                <Icon name="search" size={20} color="#94a3b8" style={styles.searchBarIcon} />
                <TextInput
                  style={styles.searchBarInput}
                  placeholder="检索离线词根..."
                  value={rootSearchInput}
                  onChangeText={(text) => { setRootSearchInput(text); setRootsPage(1); }}
                  autoCapitalize="none"
                />
                {rootSearchInput ? (
                  <TouchableOpacity onPress={() => { setRootSearchInput(''); setRootsPage(1); }}>
                    <Icon name="close-circle" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Category type filter */}
              <View style={styles.filterControlsRow}>
                <View style={styles.filterPickerWrapper}>
                  <Picker
                    selectedValue={rootTypeFilter}
                    style={styles.filterPicker}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => { setRootTypeFilter(val); setRootsPage(1); }}
                  >
                    <Picker.Item label="🏷️ 所有类型" value="all" />
                    <Picker.Item label="前缀" value="前缀" />
                    <Picker.Item label="词根" value="词根" />
                    <Picker.Item label="后缀" value="后缀" />
                    <Picker.Item label="组合部件" value="组合" />
                    <Picker.Item label="其他类型" value="其他" />
                  </Picker>
                </View>
              </View>

              {/* Sorted bar and Page stats */}
              <View style={styles.listStatsBar}>
                <Text style={styles.listStatsText}>📊 词根数量: {totalRootsCount}</Text>
                <View style={styles.sortPickerWrapper}>
                  <Picker
                    selectedValue={rootSort}
                    style={styles.sortPicker}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => setRootSort(val)}
                  >
                    <Picker.Item label="A-Z 排序" value="az" />
                    <Picker.Item label="时间排序" value="time" />
                  </Picker>
                </View>
              </View>

              {/* Loading Indicator */}
              {loadingRoots ? (
                <ActivityIndicator style={{ marginTop: 40 }} size="large" color={theme.primary} />
              ) : (
                <View style={{ flex: 1 }}>
                  <FlatList
                    data={rootsList}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => {
                      const cleanSeg = item.title.toLowerCase().replace(/^-|-$/g, '');
                      const hasStarred = starredRoots.some(r => r.segment.toLowerCase().replace(/^-|-$/g, '') === cleanSeg);
                      return (
                        <TouchableOpacity style={styles.wordItem} onPress={() => viewRootDetail(item.id)}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={styles.wordText}>{item.title}</Text>
                              <Text style={styles.rootTypeBadge}>{item.type || '词根'}</Text>
                              {hasStarred && <Text style={styles.starBadgeIcon}>★</Text>}
                            </View>
                            <Text style={styles.meaningText} numberOfLines={1}>{item.meaning}</Text>
                          </View>
                          <Icon name="chevron-forward" size={18} color="#cbd5e1" />
                        </TouchableOpacity>
                      );
                    }}
                    ListEmptyComponent={
                      <View style={styles.emptyContainer}>
                        <Icon name="leaf-outline" size={50} color="#94a3b8" />
                        <Text style={styles.emptyText}>无匹配词根结果</Text>
                      </View>
                    }
                  />

                  {/* Pagination Controls */}
                  {totalRootsCount > PAGE_SIZE && (
                    <View style={styles.paginationRow}>
                      <TouchableOpacity
                        style={[styles.pageBtn, rootsPage === 1 && styles.pageBtnDisabled]}
                        disabled={rootsPage === 1}
                        onPress={() => setRootsPage(rootsPage - 1)}
                      >
                        <Text style={styles.pageBtnText}>上一页</Text>
                      </TouchableOpacity>
                      <Text style={styles.pageIndicator}>页码: {rootsPage} / {Math.ceil(totalRootsCount / PAGE_SIZE)}</Text>
                      <TouchableOpacity
                        style={[styles.pageBtn, rootsPage * PAGE_SIZE >= totalRootsCount && styles.pageBtnDisabled]}
                        disabled={rootsPage * PAGE_SIZE >= totalRootsCount}
                        onPress={() => setRootsPage(rootsPage + 1)}
                      >
                        <Text style={styles.pageBtnText}>下一页</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* ---------------- 🌳 WORD TREE TAB ---------------- */}
      {activeTab === 'tree' && (
        <View style={styles.tabBody}>
          {!dictAvailable ? (
            <View style={styles.warningContainer}>
              <Icon name="warning-outline" size={50} color="#f59e0b" />
              <Text style={styles.warningText}>本地离线词典未导入</Text>
              <Text style={styles.warningSubText}>请前往「设置」页面导入 word.json 离线词库文件以唤醒思维图谱。</Text>
            </View>
          ) : (
            <>
              {/* Search Bar for Tree */}
              <View style={styles.treeSearchRow}>
                <TextInput
                  style={styles.treeSearchInput}
                  placeholder="输入单词或词根以生成图谱 (例如: port, tract)..."
                  value={treeSearch}
                  onChangeText={setTreeSearch}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.treeSearchBtn} onPress={() => generateTree(treeSearch)}>
                  <Text style={styles.treeSearchBtnText}>生成图谱</Text>
                </TouchableOpacity>
              </View>

              {loadingTree ? (
                <ActivityIndicator style={{ marginTop: 40 }} size="large" color={theme.primary} />
              ) : treeData ? (
                /* Scrollable visual map layout mimicking options.js logic */
                <View style={{ flex: 1 }}>
                  {/* Visual Layout Container */}
                  <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={styles.horizontalTreeCanvas} showsVerticalScrollIndicator={false}>
                      <View style={styles.horizontalTreeRow}>
                        
                        {/* 1. Left Parts Component Column */}
                        <View style={styles.treeColumn}>
                          <Text style={styles.treeColumnTitle}>🌱 部件组成 (Parts)</Text>
                          {treeData.root.segment.includes('+') ? (
                            treeData.root.segment.split('+').map((item: string, idx: number) => (
                              <View key={idx} style={styles.treeNodeWrapper}>
                                <TouchableOpacity 
                                  style={[styles.treeCardNode, { borderColor: theme.success, backgroundColor: theme.successLight }]}
                                  onPress={() => generateTree(item)}
                                >
                                  <Text style={[styles.treeCardTitle, { color: theme.successText }]}>{item}</Text>
                                  <Text style={styles.treeCardMeaning} numberOfLines={1}>点击探索</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                  style={styles.jumpBookBtn}
                                  onPress={() => {
                                    setActiveTab('roots');
                                    viewRootDetail(`R:${item.replace(/^-|-$/g, '')}`);
                                  }}
                                >
                                  <Icon name="book" size={14} color={theme.successText} />
                                </TouchableOpacity>
                              </View>
                            ))
                          ) : (
                            <View style={styles.treeNodeWrapper}>
                              <TouchableOpacity 
                                style={[styles.treeCardNode, { borderColor: theme.success, backgroundColor: theme.successLight }]}
                                onPress={() => generateTree(treeData.root.segment)}
                              >
                                <Text style={[styles.treeCardTitle, { color: theme.successText }]}>{treeData.root.segment}</Text>
                                <Text style={styles.treeCardMeaning} numberOfLines={1}>核心根源</Text>
                              </TouchableOpacity>
                              <TouchableOpacity 
                                style={styles.jumpBookBtn}
                                onPress={() => {
                                  setActiveTab('roots');
                                  viewRootDetail(`R:${treeData.root.segment.replace(/^-|-$/g, '')}`);
                                }}
                              >
                                <Icon name="book" size={14} color={theme.successText} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>

                        {/* Connection Arrows Left to Middle */}
                        <View style={styles.visualConnector}>
                          <Icon name="arrow-forward" size={24} color="#94a3b8" />
                        </View>

                        {/* 2. Middle Central Focus Column */}
                        <View style={styles.treeColumn}>
                          <Text style={styles.treeColumnTitle}>🎯 当前核心词 (Core)</Text>
                          <View style={styles.treeNodeWrapper}>
                            <View style={[styles.treeCardNode, styles.treeCardNodeActive]}>
                              <Text style={styles.treeCardTitleActive}>{treeData.root.segment}</Text>
                              <Text style={styles.treeCardMeaningActive} numberOfLines={2}>{treeData.root.meaning || '暂无核心义'}</Text>
                            </View>
                          </View>
                        </View>

                        {/* Connection Arrows Middle to Right */}
                        <View style={styles.visualConnector}>
                          <Icon name="arrow-forward" size={24} color="#94a3b8" />
                        </View>

                        {/* 3. Right Derived Words Column */}
                        <View style={styles.treeColumn}>
                          <Text style={styles.treeColumnTitle}>🌳 派生衍生词 ({treeData.derivatives.length})</Text>
                          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                            <View style={{ gap: 10 }}>
                              {treeData.derivatives.map((deriv: any, dIdx: number) => (
                                <View key={dIdx} style={styles.treeNodeWrapper}>
                                  <TouchableOpacity 
                                    style={[styles.treeCardNode, { borderColor: theme.primary, backgroundColor: theme.primaryLight }]}
                                    onPress={() => generateTree(deriv.word)}
                                  >
                                    <Text style={[styles.treeCardTitle, { color: theme.primaryText }]}>{deriv.word}</Text>
                                    <Text style={styles.treeCardMeaning} numberOfLines={1}>{deriv.meaning}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity 
                                    style={styles.jumpBookBtn}
                                    onPress={() => {
                                      setActiveTab('words');
                                      viewWordDetail({ id: `W:${deriv.word}`, title: deriv.word, meaning: deriv.meaning });
                                    }}
                                  >
                                    <Icon name="book" size={14} color={theme.primaryText} />
                                  </TouchableOpacity>
                                </View>
                              ))}
                              {treeData.derivatives.length === 0 && (
                                <Text style={styles.emptyTextMini}>暂无衍生派生词</Text>
                              )}
                            </View>
                          </ScrollView>
                        </View>

                      </View>
                    </ScrollView>
                  </ScrollView>

                  {/* Story Card at the bottom of the Tree tab */}
                  {treeData.root.deep_origin ? (
                    <View style={styles.treeOriginCard}>
                      <Text style={styles.treeOriginCardTitle}>📖 词根渊源与演变：</Text>
                      <Text style={styles.treeOriginCardText}>{treeData.root.deep_origin}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.treePlaceholder}>
                  <Icon name="git-network-outline" size={60} color="#cbd5e1" />
                  <Text style={styles.treePlaceholderText}>输入单词或核心根源，一键展开它的双向派生图谱</Text>
                </View>
              )}
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: theme.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  activeTabButton: {
    borderBottomWidth: 3,
    borderBottomColor: theme.primary,
  },
  tabButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.tabInactive,
  },
  activeTabButtonText: {
    color: theme.primary,
  },
  tabBody: {
    flex: 1,
    padding: 12,
  },
  warningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  warningText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    marginTop: 15,
  },
  warningSubText: {
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.inputBg,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    height: 46,
  },
  searchBarIcon: {
    marginRight: 8,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 15,
    color: theme.text,
    padding: 0,
  },
  filterControlsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  filterPickerWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 8,
    backgroundColor: theme.inputBg,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  filterPicker: {
    width: '100%',
    color: theme.text,
  },
  listStatsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginBottom: 8,
  },
  listStatsText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textMuted,
  },
  sortPickerWrapper: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    backgroundColor: theme.cardBg,
    width: 130,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sortPicker: {
    width: '100%',
    color: theme.text,
  },
  wordItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: theme.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 6,
  },
  wordText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: theme.text,
  },
  starBadgeIcon: {
    color: '#f59e0b',
    marginLeft: 6,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rootTypeBadge: {
    fontSize: 10,
    backgroundColor: theme.subPartBg,
    color: theme.primaryText,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
    fontWeight: '600',
    overflow: 'hidden',
  },
  meaningText: {
    fontSize: 13,
    color: theme.textMuted,
    marginTop: 4,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
  },
  emptyText: {
    fontSize: 15,
    color: theme.textMuted,
    fontWeight: '600',
    marginTop: 10,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    marginTop: 6,
  },
  pageBtn: {
    backgroundColor: theme.cardBg,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  pageBtnDisabled: {
    opacity: 0.5,
  },
  pageBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text,
  },
  pageIndicator: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: '500',
  },

  // Fixed header detail panel
  fixedDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.cardBg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    zIndex: 100,
  },
  fixedBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fixedBackBtnText: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: '700',
  },
  fixedHeaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
    flex: 1,
    textAlign: 'center',
  },

  detailCard: {
    flex: 1,
    backgroundColor: theme.cardBg,
    padding: 16,
  },
  detailTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  detailWordTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.primary,
    marginRight: 10,
  },
  volumeIcon: {
    backgroundColor: theme.volumeBg,
    borderRadius: 16,
    padding: 5,
    marginRight: 10,
  },
  detailPhonetic: {
    fontSize: 16,
    color: theme.textMuted,
  },
  detailMeaning: {
    fontSize: 17,
    color: theme.text,
    marginTop: 10,
    fontWeight: '600',
  },
  detailCoreMeaning: {
    fontSize: 14,
    color: theme.primaryText,
    marginTop: 8,
    padding: 8,
    backgroundColor: theme.primaryLight,
    borderRadius: 6,
    overflow: 'hidden',
  },
  metaSelectorsBox: {
    marginTop: 15,
    backgroundColor: theme.background,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 6,
    marginTop: 4,
  },
  statusBadgesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statusBadge: {
    backgroundColor: theme.cardBg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeLearnedBadge: {
    backgroundColor: theme.successLight,
    borderColor: theme.success,
  },
  activeLearnedText: {
    color: theme.successText,
    fontWeight: 'bold',
  },
  activeReviewBadge: {
    backgroundColor: theme.accentLight,
    borderColor: theme.accent,
  },
  activeReviewText: {
    color: theme.accentText,
    fontWeight: 'bold',
  },
  statusBadgeText: {
    fontSize: 14,
    color: theme.textMuted,
    fontWeight: '600',
  },
  folderTagsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  folderTagBadge: {
    backgroundColor: theme.cardBg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginVertical: 4,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeFolderTag: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primary,
  },
  folderTagText: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: '600',
  },
  activeFolderTagText: {
    color: theme.primaryText,
    fontWeight: 'bold',
  },
  pickerWrapperBorder: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    backgroundColor: theme.cardBg,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  detailSection: {
    marginTop: 20,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 8,
  },
  editableMemoryLineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  detailMemoryBullet: {
    fontSize: 14,
    color: theme.textMuted,
    marginRight: 6,
    marginTop: 2,
  },
  editableMemoryInput: {
    flex: 1,
    fontSize: 14,
    color: theme.text,
    lineHeight: 20,
    padding: 0,
    textAlignVertical: 'top',
  },
  saveMemoryLinesBtn: {
    backgroundColor: theme.success,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 5,
  },
  saveMemoryLinesBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  detailPartRow: {
    flexDirection: 'row',
    marginBottom: 10,
    backgroundColor: theme.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  detailSegmentBox: {
    width: 80,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.subPartBg,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  detailSegmentText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.primaryText,
    textAlign: 'center',
  },
  detailSegmentType: {
    fontSize: 10,
    color: theme.primaryText,
    marginTop: 2,
  },
  detailSegmentDetail: {
    flex: 1,
    padding: 10,
  },
  detailSegmentMeaning: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
  },
  detailSegmentOrigin: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  detailActionRow: {
    flexDirection: 'row',
    marginTop: 25,
    justifyContent: 'center',
  },
  detailActionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.accentLight,
  },
  detailActionBtnText: {
    color: theme.accentText,
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Roots Detail view
  rootDetailCard: {
    flex: 1,
    backgroundColor: theme.cardBg,
    padding: 16,
  },
  rootDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingBottom: 10,
  },
  rootDetailTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.primary,
  },
  rootDetailType: {
    fontSize: 12,
    color: theme.primaryText,
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: theme.primary,
  },
  rootDetailMeaning: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
    marginTop: 15,
  },
  rootDetailSection: {
    marginTop: 20,
  },
  rootDetailSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 6,
  },
  rootDetailBody: {
    fontSize: 14,
    color: theme.text,
    lineHeight: 22,
    backgroundColor: theme.background,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  derivGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  derivTagCard: {
    backgroundColor: theme.primaryLight,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '48%',
  },
  derivTagWord: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.primaryText,
  },
  derivTagMeaning: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 2,
  },

  // Word Tree visual
  treeSearchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  treeSearchInput: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.inputBg,
    fontSize: 15,
    color: theme.text,
  },
  treeSearchBtn: {
    backgroundColor: theme.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  treeSearchBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  treePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 40,
  },
  treePlaceholderText: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 15,
  },

  // Horizontal Tree Canvas Structure
  horizontalTreeCanvas: {
    padding: 20,
    alignItems: 'center',
  },
  horizontalTreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  treeColumn: {
    width: 200,
    backgroundColor: theme.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    alignItems: 'stretch',
    elevation: 1,
  },
  treeColumnTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.text,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingBottom: 6,
    marginBottom: 10,
    textAlign: 'center',
  },
  treeNodeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  treeCardNode: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1.5,
    padding: 8,
    alignItems: 'center',
    borderColor: theme.border,
    backgroundColor: theme.cardBg,
  },
  treeCardNodeActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentLight,
    borderWidth: 2,
    elevation: 2,
  },
  treeCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.text,
  },
  treeCardTitleActive: {
    fontSize: 17,
    fontWeight: 'bold',
    color: theme.accentText,
  },
  treeCardMeaning: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  treeCardMeaningActive: {
    fontSize: 12,
    color: theme.accentText,
    marginTop: 2,
    textAlign: 'center',
    fontWeight: '600',
  },
  jumpBookBtn: {
    padding: 6,
    backgroundColor: theme.border,
    borderRadius: 6,
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  visualConnector: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTextMini: {
    fontSize: 11,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  treeOriginCard: {
    backgroundColor: theme.primaryLight,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 12,
    padding: 16,
    marginTop: 15,
    width: '100%',
  },
  treeOriginCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.primaryText,
    marginBottom: 6,
  },
  treeOriginCardText: {
    fontSize: 13,
    color: theme.primaryText,
    lineHeight: 20,
  },
});

export default LibraryScreen;
