import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  Switch,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  BackHandler,
  ToastAndroid,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/Ionicons';
import Tts from 'react-native-tts';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from '@react-navigation/native';
import { queryOfflineWord, hasOfflineDict, getAllOfflineWords, BriefEntry } from '../utils/offlineDict';
import { fetchLLMForWord, getCachedWord } from '../utils/llmQuery';
import Sound from 'react-native-sound';

Sound.setCategory('Playback');
import { LightTheme, DarkTheme } from '../utils/theme';
import { safeSetItem } from '../utils/storage';

const HISTORY_KEY = '@word_history';
const CACHE_KEY_PREFIX = '@word_cache_';
const LIBRARY_KEY = '@word_library';
const SETTINGS_KEY = '@app_settings';

interface Part {
  segment: string;
  type: string;
  meaning: string;
  deep_origin: string;
  derivatives: string[];
}

interface WordData {
  word: string;
  display_breakdown: string;
  phonetic_us: string;
  primary_meaning: string;
  noun_source: string;
  parts: Part[];
  memory_lines: string[];
  sourceTag?: string;
}

const HomeScreen = ({ navigation, route }: any) => {
  const systemScheme = useColorScheme();
  const [uiTheme, setUiTheme] = useState('system');

  const activeTheme = uiTheme === 'system' ? (systemScheme || 'light') : uiTheme;
  const theme = activeTheme === 'dark' ? DarkTheme : LightTheme;
  const styles = getStyles(theme);

  const [word, setWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultData, setResultData] = useState<WordData | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Navigation History Stack (for popup.js-like backward jumps)
  const [navStack, setNavStack] = useState<string[]>([]);

  // Selectors State
  const [engine, setEngine] = useState('api');
  const [contextMode, setContextMode] = useState('general');
  const [rootStrategy, setRootStrategy] = useState(true);

  // Expanded part index map for accordion
  const [expandedParts, setExpandedParts] = useState<number[]>([]);

  // Custom Memory Line Editor States
  const [isEditingMemory, setIsEditingMemory] = useState(false);
  const [editedMemoryLines, setEditedMemoryLines] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<BriefEntry[]>([]);

  useEffect(() => {
    if (word.trim().length >= 1 && (!resultData || resultData.word !== word.trim())) {
      getAllOfflineWords(word, 5).then(res => {
        setSuggestions(res.items);
      });
    } else {
      setSuggestions([]);
    }
  }, [word, resultData]);

  useEffect(() => {
    if (resultData) {
      setEditedMemoryLines(resultData.memory_lines || []);
    } else {
      setEditedMemoryLines([]);
    }
    setIsEditingMemory(false);
  }, [resultData]);

  // Settings state for contexts
  const [contexts, setContexts] = useState<Array<{ id: string; name: string }>>([
    { id: 'general', name: '🌍 日常' },
    { id: 'civ6', name: '🏛️ 文明6' },
    { id: 'linux_ai', name: '🐧 极客' },
    { id: 'etymology', name: '📖 openai词源' },
    { id: 'claude', name: '📖 Anthropic词源' },
  ]);

  const [backPressCount, setBackPressCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (resultData || loading) {
          setResultData(null);
          setWord('');
          setErrorMsg('');
          return true; // prevent default behavior (exit app)
        } else {
          if (backPressCount === 0) {
            setBackPressCount(1);
            ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
            setTimeout(() => setBackPressCount(0), 2000);
            return true;
          }
          return false;
        }
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [resultData, loading, backPressCount])
  );


  useFocusEffect(
    useCallback(() => {
      loadHistory();
      loadSettings();
      loadStarredWords();
    }, [])
  );

  // Jump from other screens/routes
  useEffect(() => {
    if (route?.params?.searchWord) {
      const searchTarget = route.params.searchWord;
      setNavStack([]);
      fetchLLM(searchTarget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params]);

  const loadSettings = async () => {
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.engine) setEngine(settings.engine);
        if (settings.promptContext) setContextMode(settings.promptContext);
        if (settings.rootStrategy !== undefined) setRootStrategy(settings.rootStrategy);
        if (settings.contexts && Array.isArray(settings.contexts)) {
          setContexts(settings.contexts);
        }
      }
      
      const themeVal = await AsyncStorage.getItem('ui_theme');
      if (themeVal) {
        setUiTheme(themeVal);
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  };

  const loadHistory = async () => {
    try {
      const historyStr = await AsyncStorage.getItem(HISTORY_KEY);
      if (historyStr) {
        setHistory(JSON.parse(historyStr));
      }
    } catch (e) {
      console.error('Failed to load history', e);
    }
  };

  const saveToHistory = async (newWord: string) => {
    try {
      const lowerWord = newWord.trim().toLowerCase();
      if (!lowerWord) return;
      
      const settingsStr = await AsyncStorage.getItem('@app_settings');
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      const historyLimit = settings.historyLimit ? parseInt(settings.historyLimit, 10) : 20;
      
      setHistory((prevHistory) => {
        const filtered = prevHistory.filter((w) => w !== lowerWord);
        const updated = [lowerWord, ...filtered].slice(0, historyLimit);
        safeSetItem(HISTORY_KEY, JSON.stringify(updated));
        // 同步写入与 Chrome 插件相同的 history_list 键以达到完美数据共享
        safeSetItem('history_list', JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error('Failed to save history', e);
    }
  };

  // --- Memory Lines Editor Actions ---
  const handleAddMemoryLine = () => {
    setEditedMemoryLines((prev) => [...prev, '']);
  };

  const handleDeleteMemoryLine = (index: number) => {
    setEditedMemoryLines((prev) => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });
  };

  const handleTextChange = (text: string, index: number) => {
    setEditedMemoryLines((prev) => {
      const copy = [...prev];
      copy[index] = text;
      return copy;
    });
  };

  const handleSaveMemoryLines = async () => {
    if (!resultData) return;
    try {
      const cleanWord = resultData.word.toLowerCase().trim();
      const storageKey = 'W:' + cleanWord;
      
      const cachedStr = await AsyncStorage.getItem(storageKey);
      let wordObj = cachedStr ? JSON.parse(cachedStr) : { ...resultData };
      
      const filteredLines = editedMemoryLines.filter(l => l.trim().length > 0);
      const mapKey = `remote_${contextMode}`;
      
      if (!wordObj.memory_lines_map) {
        wordObj.memory_lines_map = {};
      }
      wordObj.memory_lines_map[mapKey] = filteredLines;
      
      if (!wordObj.edited_keys) {
        wordObj.edited_keys = [];
      }
      if (!wordObj.edited_keys.includes(mapKey)) {
        wordObj.edited_keys.push(mapKey);
      }
      
      wordObj.memory_lines = filteredLines;
      wordObj.sourceTag = 'api';
      
      await safeSetItem(storageKey, JSON.stringify(wordObj));
      
      // 同步更新特训库
      const libStr = await AsyncStorage.getItem(LIBRARY_KEY);
      if (libStr) {
        let lib = JSON.parse(libStr);
        let exists = false;
        lib = lib.map((item: any) => {
          if (item.word.toLowerCase() === cleanWord) {
            exists = true;
            return {
              ...item,
              ...wordObj,
            };
          }
          return item;
        });
        if (exists) {
          await safeSetItem(LIBRARY_KEY, JSON.stringify(lib));
        }
      }
      
      setResultData(wordObj);
      setIsEditingMemory(false);
      Alert.alert('提示', '记忆联想修改保存成功！');
    } catch (e: any) {
      Alert.alert('保存失败', e.message || '存储写入错误');
    }
  };

  const [starredWords, setStarredWords] = useState<any[]>([]);

  const loadStarredWords = async () => {
    try {
      const libStr = await AsyncStorage.getItem(LIBRARY_KEY);
      if (libStr) {
        setStarredWords(JSON.parse(libStr));
      } else {
        setStarredWords([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleStar = async (data: WordData) => {
    try {
      const cleanWord = data.word.toLowerCase().trim();
      const isStarred = starredWords.some(w => w.word.toLowerCase() === cleanWord);
      
      if (isStarred) {
        // Unstar
        const updated = starredWords.filter((w) => w.word.toLowerCase() !== cleanWord);
        setStarredWords(updated);
        await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));

        const storageKey = 'W:' + cleanWord;
        const stored = await AsyncStorage.getItem(storageKey);
        if (stored) {
          const obj = JSON.parse(stored);
          obj.is_favorite = false;
          obj.favorite_folder_ids = [];
          await safeSetItem(storageKey, JSON.stringify(obj));
        }
        Alert.alert('提示', '已取消收藏');
      } else {
        // Star
        const storageKey = 'W:' + cleanWord;
        const storedStr = await AsyncStorage.getItem(storageKey);
        let wordObj = storedStr ? JSON.parse(storedStr) : data;
        
        wordObj.is_favorite = true;
        if (!wordObj.favorite_folder_ids) {
          wordObj.favorite_folder_ids = [];
        }
        if (!wordObj.favorite_folder_ids.includes('fav_default')) {
          wordObj.favorite_folder_ids.push('fav_default');
        }
        
        await safeSetItem(storageKey, JSON.stringify(wordObj));
        
        const updated = [wordObj, ...starredWords.filter((w) => w.word.toLowerCase() !== cleanWord)];
        setStarredWords(updated);
        await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));
        
        Alert.alert('提示', '已加入收藏夹');
      }
    } catch (e) {
      console.error('Failed to toggle star', e);
    }
  };

  const toggleRootStrategy = async (value: boolean) => {
    setRootStrategy(value);
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      settings.rootStrategy = value;
      await safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error(e);
    }
  };

  const handleEngineChange = async (val: string) => {
    setEngine(val);
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      settings.engine = val;
      await safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save engine to storage', e);
    }
    if (word.trim()) fetchLLM(word.trim(), false, false);
  };

  const handleContextChange = async (val: string) => {
    setContextMode(val);
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      settings.promptContext = val;
      await safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save context to storage', e);
    }
    if (word.trim()) fetchLLM(word.trim(), false, false);
  };

  const fetchLLM = async (targetWord: string, forceRefresh: boolean = false, isBackAction: boolean = false) => {
    const input = targetWord.trim().toLowerCase();
    if (!input) return;

    if (!isBackAction && resultData && resultData.word.toLowerCase() !== input) {
      setNavStack((prev) => [...prev, resultData.word]);
    }

    setLoading(true);
    setErrorMsg('');
    setResultData(null);
    setWord(input);
    setExpandedParts([]); // Reset parts accordion

    try {
      const data = await fetchLLMForWord(input, forceRefresh, engine, contextMode);
      setResultData(data);
      saveToHistory(input);
    } catch (error: any) {
      setErrorMsg(error.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegen = async () => {
    const input = word.trim().toLowerCase();
    if (!input) return;
    
    try {
      const storageKey = 'W:' + input;
      const cachedStr = await AsyncStorage.getItem(storageKey);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (cached.edited_keys) {
          delete cached.edited_keys;
          await safeSetItem(storageKey, JSON.stringify(cached));
        }
      }
    } catch (e) {
      console.error('Failed to clear edited_keys for regen', e);
    }
    
    fetchLLM(input, true);
  };

  const handleBackAction = () => {
    const stackCopy = [...navStack];
    const prevWord = stackCopy.pop();
    setNavStack(stackCopy);
    if (prevWord) {
      fetchLLM(prevWord, false, true);
    }
  };

  const playPhoneticSound = async (text: string) => {
    try {
      const cleanWord = text.replace(/^-|-$/g, '').trim();
      
      // Try local TTS first
      try {
        Tts.stop();
        await Tts.setDefaultLanguage('en-US');
        Tts.speak(cleanWord);
        return;
      } catch (ttsErr) {
        console.log('Local TTS failed, falling back to online audio...', ttsErr);
      }

      // Fallback to online dictionary voice (Youdao API)
      const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=2`;
      const sound = new Sound(url, '', (error) => {
        if (error) {
          console.warn('Failed to load online sound', error);
          Alert.alert('发音失败', '本地发音引擎不可用，且网络加载备用发音也失败了，请检查网络。');
          return;
        }
        sound.play((success) => {
          sound.release();
        });
      });
    } catch (e) {
      console.warn('Phonetic sound error:', e);
    }
  };

  const handleTogglePart = (index: number) => {
    if (expandedParts.includes(index)) {
      setExpandedParts(expandedParts.filter((idx) => idx !== index));
    } else {
      setExpandedParts([...expandedParts, index]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBar} backgroundColor={theme.background} />
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scrollArea} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>词根引擎</Text>
          </View>

          {/* Selectors Row */}
          <View style={styles.selectorsRow}>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={engine}
                style={[styles.picker, { color: theme.text }]}
                dropdownIconColor={theme.primary}
                onValueChange={handleEngineChange}
              >
                <Picker.Item label="🌐 API模式" value="api" />
                <Picker.Item label="💾 离线模式" value="local" />
              </Picker>
            </View>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={contextMode}
                style={[styles.picker, { color: theme.text }]}
                dropdownIconColor={theme.primary}
                onValueChange={handleContextChange}
              >
                {contexts.map((ctx) => (
                  <Picker.Item key={ctx.id} label={ctx.name} value={ctx.id} />
                ))}
              </Picker>
            </View>
            <View style={styles.rootStrategyContainer}>
              <Text style={styles.rootStrategyLabel}>护根</Text>
              <Switch
                value={rootStrategy}
                onValueChange={toggleRootStrategy}
                trackColor={{ false: theme.border, true: theme.primaryLight }}
                thumbColor={rootStrategy ? theme.primary : theme.textMuted}
              />
            </View>
          </View>

          <View style={styles.searchContainer}>
            {navStack.length > 0 && (
              <TouchableOpacity style={styles.backBtn} onPress={handleBackAction}>
                <Icon name="arrow-back" size={22} color={theme.text} />
              </TouchableOpacity>
            )}
            <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 0 }]}>
              <TextInput
                style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }}
                placeholder="输入要拆解的单词/词根..."
                placeholderTextColor={theme.textMuted}
                value={word}
                onChangeText={setWord}
                autoCapitalize="none"
                onSubmitEditing={() => fetchLLM(word)}
              />
              {word.length > 0 && (
                <TouchableOpacity onPress={() => { setWord(''); setSuggestions([]); }} style={{ padding: 4 }}>
                  <Icon name="close-circle" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.searchBtn} onPress={() => fetchLLM(word)}>
              <Icon name="search-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.searchBtn, { backgroundColor: '#f97316' }]}
              onPress={handleRegen}
            >
              <Icon name="sync-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          {suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((s, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  style={[styles.suggestionItem, idx < suggestions.length - 1 && styles.suggestionItemBorder]}
                  onPress={() => {
                    setWord(s.title);
                    setSuggestions([]);
                    fetchLLM(s.title);
                  }}
                >
                  <Text style={styles.suggestionTitle}>{s.title}</Text>
                  <Text style={styles.suggestionMeaning} numberOfLines={1}>{s.meaning}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {history.length > 0 && (
            <View style={styles.historyContainer}>
              <Text style={styles.historyTitle}>🕒 历史: </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
                {history.map((h, i) => (
                  <TouchableOpacity key={i} style={styles.historyChip} onPress={() => { setNavStack([]); fetchLLM(h); }}>
                    <Text style={styles.historyChipText}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {loading && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={styles.loadingText}>🧠 {engine === 'local' ? '本地词库深度检索中...' : 'AI 引擎深度解析中...'}</Text>
              <Text style={styles.loadingWord}>「{word}」</Text>
            </View>
          )}

          {!loading && errorMsg !== '' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {!loading && !errorMsg && !resultData && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, marginTop: 40 }}>
              <Icon name="planet-outline" size={80} color={theme.primary} style={{ opacity: 0.8, marginBottom: 20 }} />
              <Text style={{ color: theme.text, fontSize: 24, fontWeight: '900', marginBottom: 12 }}>问根引擎已就绪 🚀</Text>
              <Text style={{ color: theme.textMuted, fontSize: 15, textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>
                本地词库极速响应，云端大模型深度穿透
              </Text>
              
              <View style={{ backgroundColor: theme.cardBg, borderRadius: 20, padding: 20, width: '100%', borderWidth: 1, borderColor: theme.border, shadowColor: theme.primary, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 }}>
                <Text style={{ color: theme.primaryText, fontWeight: '800', fontSize: 16, marginBottom: 16 }}>💡 新手破冰指南</Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
                  <Icon name="search" size={20} color="#3b82f6" style={{ marginRight: 12, marginTop: 2 }} />
                  <Text style={{ color: theme.text, fontSize: 14, flex: 1, lineHeight: 22 }}>输入单词/词根，点击<Text style={{fontWeight:'bold', color: '#3b82f6'}}>蓝色按钮</Text>查词，瞬间瓦解它的前世今生。</Text>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
                  <Icon name="sync-circle-outline" size={20} color="#f97316" style={{ marginRight: 12, marginTop: 2 }} />
                  <Text style={{ color: theme.text, fontSize: 14, flex: 1, lineHeight: 22 }}>若想获取最新解读，点击<Text style={{fontWeight:'bold', color: '#f97316'}}>橙色按钮</Text>，强制呼唤AI重写脑洞联想。</Text>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
                  <Icon name="earth-outline" size={20} color="#10b981" style={{ marginRight: 12, marginTop: 2 }} />
                  <Text style={{ color: theme.text, fontSize: 14, flex: 1, lineHeight: 22 }}>试试顶部的<Text style={{fontWeight:'bold', color: '#10b981'}}>情景模式</Text>，让 AI 用“极客”、“考研”等专属人设解析。</Text>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Icon name="star-outline" size={20} color="#eab308" style={{ marginRight: 12, marginTop: 2 }} />
                  <Text style={{ color: theme.text, fontSize: 14, flex: 1, lineHeight: 22 }}>碰到硬骨头点<Text style={{fontWeight:'bold', color: '#eab308'}}>收藏</Text>，去底栏的【收藏夹】划卡特训。</Text>
                </View>
              </View>
            </View>
          )}

          {!loading && resultData && (
            <View style={styles.resultBox}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: theme.textMuted, letterSpacing: 0.5 }}>{resultData.word}</Text>
                <TouchableOpacity 
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.cardBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}
                  onPress={() => {
                    setResultData(null);
                    setWord('');
                    setErrorMsg('');
                  }}
                >
                  <Icon name="arrow-undo-outline" size={16} color={theme.text} style={{marginRight: 4}} />
                  <Text style={{ fontSize: 13, color: theme.text, fontWeight: 'bold' }}>返回</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.wordHeader}>
                <Text style={styles.wordBreakdown}>{resultData.display_breakdown || resultData.word}</Text>
                <TouchableOpacity onPress={() => playPhoneticSound(resultData.word)} style={styles.volumeIcon}>
                  <Icon name="volume-medium-outline" size={24} color={theme.primary} />
                </TouchableOpacity>
                {resultData.phonetic_us ? (
                  <Text style={styles.phonetic}>/{resultData.phonetic_us}/</Text>
                ) : null}
              </View>
              <Text style={styles.primaryMeaning}>{resultData.primary_meaning}</Text>
              {resultData.noun_source ? (
                <Text style={styles.coreMeaning}>🎯 名词源追溯：{resultData.noun_source}</Text>
              ) : null}

              <View style={styles.partsContainer}>
                {resultData.parts?.map((part, index) => {
                  const isExpanded = expandedParts.includes(index);
                  return (
                    <View key={index} style={styles.partRow}>
                      <TouchableOpacity
                        style={styles.segmentBox}
                        onPress={() => {
                          navigation.navigate('Library', {
                            initialRoot: `R:${part.segment.replace(/^-|-$/g, '')}`,
                            activeTab: 'roots'
                          });
                        }}
                      >
                        <Text style={styles.segmentText}>{part.segment}</Text>
                        <Text style={styles.segmentType}>{part.type}</Text>
                        <Text style={{ fontSize: 9, color: '#0284c7', marginTop: 2, textDecorationLine: 'underline' }}>查看词根</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.detailBox}
                        activeOpacity={0.8}
                        onPress={() => handleTogglePart(index)}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.meaningText}>{part.meaning}</Text>
                          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#94a3b8" />
                        </View>
                        
                        {isExpanded && (
                          <View style={styles.deepDetail}>
                            {part.deep_origin ? (
                              <>
                                <Text style={styles.detailBold}>📖 渊源故事：</Text>
                                <Text style={styles.detailBody}>{part.deep_origin}</Text>
                              </>
                            ) : null}
                            {part.derivatives && part.derivatives.length > 0 ? (
                              <>
                                <Text style={[styles.detailBold, { marginTop: part.deep_origin ? 8 : 0 }]}>🌿 同根派生：</Text>
                                <View style={styles.derivativesContainer}>
                                  {part.derivatives.map((deriv, dIdx) => (
                                    <TouchableOpacity
                                      key={dIdx}
                                      style={styles.derivativeWordTag}
                                      onPress={() => fetchLLM(deriv)}
                                    >
                                      <Text style={styles.derivativeWordText}>{deriv}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </>
                            ) : null}
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

              <View style={styles.memoryContainer}>
                <View style={styles.memoryTitleBox}>
                  <Text style={styles.memoryTitle}>💡 情境联想</Text>
                  <Text style={styles.sourceBadge}>{resultData.sourceTag === 'api' ? '🌐 API' : '💾 缓存'}</Text>
                  <View style={{ flex: 1 }} />
                  {!isEditingMemory ? (
                    <TouchableOpacity 
                      style={styles.editMemoryLinesTrigger} 
                      onPress={() => {
                        setEditedMemoryLines(resultData.memory_lines || []);
                        setIsEditingMemory(true);
                      }}
                    >
                      <Text style={styles.editMemoryLinesTriggerText}>📝 编辑联想</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: 'row' }}>
                      <TouchableOpacity style={styles.saveMemoryLinesTrigger} onPress={handleSaveMemoryLines}>
                        <Text style={styles.saveMemoryLinesTriggerText}>💾 保存</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelMemoryLinesTrigger} onPress={() => setIsEditingMemory(false)}>
                        <Text style={styles.cancelMemoryLinesTriggerText}>取消</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                
                {!isEditingMemory ? (
                  (resultData.memory_lines && resultData.memory_lines.length > 0 ? (
                    resultData.memory_lines.map((line, index) => (
                      <View key={index} style={styles.memoryLineItem}>
                        <Text style={styles.memoryBullet}>•</Text>
                        <Text style={styles.memoryLineText}>{line}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic', marginVertical: 4 }}>暂无联想笔记，可点击上方编辑添加</Text>
                  ))
                ) : (
                  <View>
                    {editedMemoryLines.map((line, index) => (
                      <View key={index} style={styles.editableMemoryRow}>
                        <Text style={styles.memoryBullet}>•</Text>
                        <TextInput
                          style={styles.editableMemoryInputText}
                          value={line}
                          onChangeText={(text) => handleTextChange(text, index)}
                          multiline
                          placeholder="输入你独创的记忆画面..."
                        />
                        <TouchableOpacity style={styles.deleteMemoryLineBtn} onPress={() => handleDeleteMemoryLine(index)}>
                          <Icon name="trash-outline" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity style={styles.addMemoryLineBtn} onPress={handleAddMemoryLine}>
                      <Text style={styles.addMemoryLineBtnText}>+ 增加一条联想</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtnLib, { marginHorizontal: 6, marginBottom: 12 }]} onPress={() => toggleStar(resultData)}>
                  <Text style={styles.actionBtnTextLib}>
                    {starredWords.some(w => w.word.toLowerCase() === resultData.word.toLowerCase()) ? '⭐ 取消收藏' : '★ 收藏'}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.actionBtnLib, { borderColor: theme.primary, backgroundColor: theme.primaryLight, marginHorizontal: 6, marginBottom: 12 }]} 
                  onPress={() => {
                    navigation.navigate('Favorites');
                  }}
                >
                  <Text style={[styles.actionBtnTextLib, { color: theme.primaryText }]}>🃏 去特训</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.actionBtnLib, { borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.1)', marginHorizontal: 6, marginBottom: 12 }]} 
                  onPress={() => {
                    navigation.navigate('Library', {
                      initialWord: resultData.word,
                      activeTab: 'tree'
                    });
                  }}
                >
                  <Text style={[styles.actionBtnTextLib, { color: '#0ea5e9' }]}>🌳 词根记忆树</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scrollContent: { paddingBottom: 40 },
  header: {
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: theme.cardBg,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: theme.text },
  selectorsRow: {
    flexDirection: 'row',
    backgroundColor: theme.cardBg,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    alignItems: 'center',
  },
  pickerContainer: {
    flex: 1,
    height: 50,
    justifyContent: 'center',
  },
  picker: {
    width: '100%',
  },
  rootStrategyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  rootStrategyLabel: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: 'bold',
    marginRight: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.cardBg,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: theme.shadowColor,
    shadowOpacity: theme.shadowOpacity,
    elevation: 2,
  },
  backBtn: {
    paddingRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    flexShrink: 1,
    height: 44,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 8,
    backgroundColor: theme.inputBg,
    marginRight: 8,
  },
  searchBtn: {
    width: 44,
    height: 44,
    backgroundColor: theme.primary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  volumeIcon: {
    backgroundColor: theme.volumeBg,
    borderRadius: 16,
    padding: 5,
    marginRight: 10,
    marginLeft: 4,
  },
  suggestionsContainer: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: theme.cardBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOpacity: theme.shadowOpacity,
    elevation: 2,
    zIndex: 10,
  },
  suggestionItem: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  suggestionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.text,
    marginRight: 8,
  },
  suggestionMeaning: {
    flex: 1,
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'right',
  },
  historyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    height: 50,
  },
  historyTitle: { fontSize: 12, color: theme.textMuted, marginRight: 8 },
  historyChip: {
    backgroundColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    justifyContent: 'center',
  },
  historyChipText: { fontSize: 13, color: theme.text },
  scrollArea: { flex: 1, padding: 12 },
  loadingBox: { marginTop: 40, alignItems: 'center' },
  loadingText: { marginTop: 16, color: theme.textMuted, fontSize: 15 },
  loadingWord: { marginTop: 8, color: theme.text, fontSize: 18, fontWeight: 'bold' },
  errorBox: { marginTop: 20, padding: 16, backgroundColor: theme.dangerLight, borderRadius: 8 },
  errorText: { color: theme.dangerText, lineHeight: 22 },
  welcomeBox: {
    marginTop: 20,
    padding: 20,
    backgroundColor: theme.cardBg,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  welcomeTitle: { fontSize: 18, fontWeight: 'bold', color: theme.text, marginBottom: 8 },
  welcomeSub: { fontSize: 14, color: theme.textMuted },
  resultBox: {
    backgroundColor: theme.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOpacity: theme.shadowOpacity,
    elevation: 1,
  },
  wordHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  wordBreakdown: { fontSize: 24, fontWeight: 'bold', color: theme.text, marginRight: 4 },
  phonetic: { fontSize: 16, color: theme.textMuted, marginLeft: 4 },
  primaryMeaning: { fontSize: 18, color: theme.text, marginTop: 8, fontWeight: '600' },
  coreMeaning: {
    fontSize: 14,
    color: theme.primaryText,
    marginTop: 8,
    padding: 8,
    backgroundColor: theme.primaryLight,
    borderRadius: 6,
    overflow: 'hidden',
  },
  partsContainer: { marginTop: 16 },
  partRow: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: theme.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  segmentBox: {
    width: 80,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.subPartBg,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  segmentText: { fontSize: 15, fontWeight: 'bold', color: theme.primaryText, textAlign: 'center' },
  segmentType: { fontSize: 10, color: theme.primaryText, marginTop: 2, textAlign: 'center' },
  detailBox: { flex: 1, padding: 12 },
  meaningText: { flex: 1, marginRight: 8, fontSize: 15, fontWeight: '600', color: theme.text },
  deepDetail: { backgroundColor: theme.cardBg, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.border, marginTop: 8 },
  detailBold: { fontSize: 13, fontWeight: 'bold', color: theme.text },
  detailBody: { fontSize: 13, color: theme.textMuted, lineHeight: 20, marginTop: 4 },
  derivativesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 6,
  },
  derivativeWordTag: {
    backgroundColor: theme.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  derivativeWordText: {
    fontSize: 12,
    color: theme.primaryText,
    fontWeight: '500',
  },
  memoryContainer: { marginTop: 16 },
  memoryTitleBox: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  memoryTitle: { fontSize: 16, fontWeight: 'bold', color: theme.text, marginRight: 8 },
  sourceBadge: { fontSize: 10, backgroundColor: '#f97316', color: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  memoryLineItem: { flexDirection: 'row', marginBottom: 6 },
  memoryBullet: { fontSize: 14, color: theme.textMuted, marginRight: 6, marginTop: 2 },
  memoryLineText: { flex: 1, fontSize: 14, color: theme.text, lineHeight: 22 },
  actionRow: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  actionBtnLib: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: theme.cardBg,
    borderWidth: 1.5,
    borderColor: theme.accentLight,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnTextLib: {
    color: theme.accentText,
    fontSize: 14,
    fontWeight: 'bold',
  },
  editMemoryLinesTrigger: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.border,
    borderWidth: 1,
    borderColor: theme.border,
  },
  editMemoryLinesTriggerText: {
    fontSize: 12,
    color: theme.primary,
    fontWeight: 'bold',
  },
  saveMemoryLinesTrigger: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.success,
  },
  saveMemoryLinesTriggerText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
  },
  cancelMemoryLinesTrigger: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.danger,
  },
  cancelMemoryLinesTriggerText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
  },
  editableMemoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  editableMemoryInputText: {
    flex: 1,
    fontSize: 14,
    color: theme.text,
    paddingVertical: 4,
    textAlignVertical: 'top',
  },
  deleteMemoryLineBtn: {
    padding: 6,
  },
  addMemoryLineBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    marginTop: 4,
  },
  addMemoryLineBtnText: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '600',
  },
});

export default HomeScreen;
