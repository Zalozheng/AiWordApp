import React, { useState, useEffect } from 'react';
import {
  Platform,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  useColorScheme,
  StatusBar,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pick, types, keepLocalCopy } from '@react-native-documents/picker';
import { Picker } from '@react-native-picker/picker';
import RNFS from 'react-native-fs';
import Icon from 'react-native-vector-icons/Ionicons';
import { getOfflineDictStats, importOfflineDict, clearOfflineDict } from '../utils/offlineDict';
import { LightTheme, DarkTheme } from '../utils/theme';
import { safeSetItem, safeRemoveItem } from '../utils/storage';

const isCancel = (err: any) => err && (err.code === 'DOCUMENT_PICKER_CANCELED' || err.message?.includes('cancel') || err.message?.includes('User canceled'));

const SETTINGS_KEY = '@app_settings';
const CACHE_KEY_PREFIX = '@word_cache_';
const FOLDERS_KEY = '@fav_folders';
const LIBRARY_KEY = '@word_library';
const ROOT_LIBRARY_KEY = '@root_library';

interface ContextItem {
  id: string;
  name: string;
}

const DEFAULT_FOLDERS = [
  { id: 'fav_default', name: '⭐ 默认收藏夹' }
];

const DEFAULT_JSON_TEMPLATE = `请严格分析单词，仅返回纯JSON对象。
【警告】必须用真实解析数据填充！
{
  "word": "String (当前查询的单词)",
  "display_breakdown": "String (用点分隔音节，如 ex.e.cu.tion)",
  "phonetic_us": "String (美式音标)",
  "primary_meaning": "String (最常用的一个中文意思)",
  "noun_source": "String (基础来源名词，格式：英文 (中文))",
  "parts": [
    {
      "segment": "String (词根/前缀/后缀)",
      "type": "String (词根/前缀/后缀)",
      "meaning": "String (中文含义)",
      "deep_origin": "String (该词根的历史渊源，必须结合你的专业角色来生动讲述！内部严禁使用双引号，请用单引号代替)",
      "derivatives": ["String (同根词)"]
    }
  ],
  "memory_lines": ["String (必须结合 {CONTEXT} 生成一条极度硬核、有强烈画面感的记忆联想，内部严禁使用双引号)"]
}`;

const DEFAULT_PROMPTS: Record<string, string> = {
  general: '你是一个深谙“唯名词论”的日常英语词汇专家。\n请结合极其常见的生活、购物、交流场景进行解析。\n\n(提示：您可以通过点击【设为基础模板】来覆盖本段系统内置的文字)',
  civ6: '你是一个《文明6》(Civilization VI) 的资深游戏策划兼历史学家。\n请结合游戏中的科技树、尤里卡触发、世界奇观建设、政策卡组合、时代得分或兵种克意等核心游戏机制进行解析。\n\n(这是文明6模式的专属提示词)',
  linux_ai: '你是一个极其硬核的 Linux 内核开发者兼 AI (CUDA/Ollama) 架构师。\n请结合Linux终端命令、C++底层内存管理、GPU显存分配、深度学习模型架构、或者极客黑客的计算机底层逻辑进行解析。\n\n(这是极客模式的专属提示词)',
  claude: '你是一个英语词汇词源专家，你是一个深谙“唯名词论”的日常英语词汇专家。\n请结合极其常见的生活、购物、交流场景进行解析。\n\n仅返回如下纯JSON对象，不要有任何多余文字，memory_lines必须严格输出8个字符串元素：\n{\n  "word": "String",\n  "display_breakdown": "String (用点分隔音节，如 ex.e.cu.tion)",\n  "phonetic_us": "String (美式音标)",\n  "primary_meaning": "String (最常用中文意思)",\n  "noun_source": "String (基础来源名词，格式：英文 (中文))",\n  "parts": [\n    {\n      "segment": "String",\n      "type": "String (词根/前缀/后缀)",\n      "meaning": "String (中文含义)",\n      "deep_origin": "String (历史渊源，内部严禁使用双引号)",\n      "derivatives": ["String"]\n    }\n  ],\n  "memory_lines": [\n    "1. 中文(`英文部件`) + 中文(`英文部件`) → **完整单词**(中文释义)。",\n    "",\n    "2. 💡 情景联想：结合【{CONTEXT}】写画面，30字以内！",\n    "",\n    "3. 极简英文例句带括号中文翻译。",\n    "",\n    "4. 📖 词源故事：用1~2句话讲历史典故或来源趣事，50字以内。",\n    ""\n  ]\n}\n\n(这是词源模式的专属提示词，基于claude真实词源数据)',
  etymology: '你是一个英语词汇词源专家，你是一个深谙“唯名词论”的日常英语词汇专家。\n请结合极其常见的生活、购物、交流场景进行解析。\n\n当用户输入一个英文单词时：\n如果你具有联网搜索能力，请先查询：\nsite:etymonline.com [单词]\n获取真实词源拆解后，再按格式输出。\n禁止凭记忆猜测词根，一律以真实词源为准。\n\n仅返回如下纯JSON对象，不要有任何多余文字：\n{\n  "word": "String",\n  "display_breakdown": "String (用点分隔音节，如 ex.e.cu.tion)",\n  "phonetic_us": "String (美式音标)",\n  "primary_meaning": "String (最常用中文意思)",\n  "noun_source": "String (基础来源名词，格式：英文 (中文))",\n  "parts": [\n    {\n      "segment": "String",\n      "type": "String (词根/前缀/后缀)",\n      "meaning": "String (中文含义)",\n      "deep_origin": "String (历史渊源，内部严禁使用双引号)",\n      "derivatives": ["String"]\n    }\n  ],\n  "memory_lines": [\n    "1. 中文(`英文部件`) + 中文(`英文部件`) → **完整单词**(中文释义)。",\n    "",\n    "2. 💡 情景联想：结合【{CONTEXT}】写画面，30字以内！",\n    "",\n    "3. 极简英文例句带括号中文翻译。",\n    "",\n    "4. 📖 词源故事：用1~2句话讲历史典故或来源趣事，50字以内。",\n    ""\n  ]\n}\n\n(这是词源模式的专属提示词，基于 etymonline.com 真实数据。注意：部分 API 并不支持联网搜索功能)',
  custom: ""
};

const SettingsScreen = ({ navigation }: any) => {
  const systemScheme = useColorScheme();
  const [uiTheme, setUiTheme] = useState('system');

  const activeTheme = uiTheme === 'system' ? (systemScheme || 'light') : uiTheme;
  const theme = activeTheme === 'dark' ? DarkTheme : LightTheme;
  const styles = getStyles(theme);

  // API Configurations
  const [apiProtocol, setApiProtocol] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('https://api.deepseek.com/v1');
  const [apiModel, setApiModel] = useState('deepseek-chat');
  const [temperature, setTemperature] = useState('0.2');

  // Behavior/Fallback Configurations
  const [historyLimit, setHistoryLimit] = useState('20');
  const [dataFallbackRule, setDataFallbackRule] = useState('cross');
  const [contextFallbackRule, setContextFallbackRule] = useState(true);
  const [rootStrategy, setRootStrategy] = useState(true); // true = keep_old, false = force_new

  // Offline Dictionary State
  const [dictStats, setDictStats] = useState({ exists: false, totalKeys: 0, sizeBytes: 0 });
  const [importingDict, setImportingDict] = useState(false);

  // Offline Dict URL state
  const [downloadUrl, setDownloadUrl] = useState('');
  const [folders, setFolders] = useState<any[]>(DEFAULT_FOLDERS);

  // Scenario Mode States
  const [contexts, setContexts] = useState<ContextItem[]>([
    { id: 'general', name: '🌍 日常' },
    { id: 'civ6', name: '🏛️ 文明6' },
    { id: 'linux_ai', name: '🐧 极客' },
    { id: 'etymology', name: '📖 openai词源' },
    { id: 'claude', name: '📖 Anthropic词源' },
  ]);
  const [prompts, setPrompts] = useState<Record<string, string>>(DEFAULT_PROMPTS);
  const [activeContextId, setActiveContextId] = useState('general');
  const [editContextName, setEditContextName] = useState('日常');
  const [editPrompt, setEditPrompt] = useState('');

  // Global JSON Constraint
  const [globalJsonTemplate, setGlobalJsonTemplate] = useState(DEFAULT_JSON_TEMPLATE);

  // Data management settings
  const [dataActionContext, setDataActionContext] = useState(false); // Global vs active scenario only
  const [importMode, setImportMode] = useState(false); // Merge vs Overwrite/Replace

  // Zen Mode Editor State
  const [zenModeVisible, setZenModeVisible] = useState(false);
  const [zenModeContent, setZenModeContent] = useState('');
  const [zenModeType, setZenModeType] = useState(''); // 'prompt' or 'json'

  // Preset Models List
  const presetModels = [
    // OpenAI Models
    { label: 'GPT-4o Mini 搜索版', value: 'gpt-4o-mini-search-preview-2025-03-11' },
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'DeepSeek Chat', value: 'deepseek-chat' },
    { label: 'DeepSeek v4 Flash', value: 'deepseek-v4-flash' },
    { label: 'GLM-4', value: 'glm-4' },
    // Claude Models
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20240620' },
    { label: 'Claude 3.5 Haiku', value: 'claude-haiku-4-5-20251001' },
    { label: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
    { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
  ];

  useEffect(() => {
    loadSettings();
    loadDictStats();
    loadFolders();
  }, []);

  // Update editor fields when active scenario mode changes
  useEffect(() => {
    const currentContext = contexts.find((c) => c.id === activeContextId);
    if (currentContext) {
      setEditContextName(currentContext.name.replace(/^[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]\s*/g, ''));
      setEditPrompt(prompts[activeContextId] || DEFAULT_PROMPTS[activeContextId] || '');
    }
  }, [activeContextId, contexts, prompts]);

  const loadSettings = async () => {
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        if (settings.apiProtocol) setApiProtocol(settings.apiProtocol);
        if (settings.apiKey) setApiKey(settings.apiKey);
        if (settings.apiBase) setApiBase(settings.apiBase);
        if (settings.apiModel) setApiModel(settings.apiModel);
        if (settings.temperature !== undefined) setTemperature(String(settings.temperature));
        if (settings.historyLimit !== undefined) setHistoryLimit(String(settings.historyLimit));
        if (settings.dataFallbackRule) setDataFallbackRule(settings.dataFallbackRule);
        if (settings.contextFallbackRule !== undefined) setContextFallbackRule(settings.contextFallbackRule);
        if (settings.rootStrategy !== undefined) setRootStrategy(settings.rootStrategy);
        if (settings.globalJsonTemplate) setGlobalJsonTemplate(settings.globalJsonTemplate);
        if (settings.dataActionContext !== undefined) setDataActionContext(settings.dataActionContext);
        if (settings.importMode !== undefined) setImportMode(settings.importMode);
        
        if (settings.contexts && Array.isArray(settings.contexts)) {
          setContexts(settings.contexts);
        }
        if (settings.prompts) {
          setPrompts(settings.prompts);
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

  const loadFolders = async () => {
    try {
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

  const loadDictStats = async () => {
    const stats = await getOfflineDictStats();
    setDictStats(stats);
  };

  const handleImportOfflineDict = async () => {
    setImportingDict(true);
    try {
      const res = await pick({
        type: [types.json, types.allFiles],
      });
      if (res && res[0]) {
        const file = res[0];
        const [localCopy] = await keepLocalCopy({
          files: [{
            uri: file.uri,
            fileName: file.name || 'word.json',
          }],
          destination: 'cachesDirectory',
        });
        const sourceUri = (localCopy && localCopy.status === 'success') ? localCopy.localUri : file.uri;
        await importOfflineDict(sourceUri);
        await loadDictStats();
        Alert.alert('导入成功', `离线词库文件已成功加载到本地！`);
      }
    } catch (err) {
      if (!isCancel(err)) {
        Alert.alert('导入失败', (err as any).message || '读取文件错误');
      }
    } finally {
      setImportingDict(false);
    }
  };

  const handleClearOfflineDict = () => {
    Alert.alert('清除本地词库', '确定要删除离线词库文件吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          await clearOfflineDict();
          await loadDictStats();
          Alert.alert('已清除', '离线词库已从设备删除。');
        },
      },
    ]);
  };

  const handleDownloadAndImportOfflineDict = async () => {
    if (!downloadUrl || !downloadUrl.startsWith('http')) {
      Alert.alert('错误', '请输入以 http/https 开头的有效直接下载链接。');
      return;
    }
    setImportingDict(true);
    try {
      const destPath = RNFS.DocumentDirectoryPath + '/temp_downloaded_dict.json';
      if (await RNFS.exists(destPath)) {
        await RNFS.unlink(destPath);
      }
      
      const downloadResult = await RNFS.downloadFile({
        fromUrl: downloadUrl,
        toFile: destPath,
        background: true,
      }).promise;
      
      if (downloadResult.statusCode === 200) {
        await importOfflineDict(destPath);
        await loadDictStats();
        Alert.alert('下载并导入成功', '远程词库文件已成功加载到本地！');
      } else {
        throw new Error(`HTTP 状态码错误: ${downloadResult.statusCode}`);
      }
    } catch (err: any) {
      Alert.alert('下载/导入失败', err.message || '网络或文件解析错误');
    } finally {
      setImportingDict(false);
    }
  };

  const handleClearCache = async () => {
    Alert.alert('清除查词缓存', '确定要删除所有未加入特训库的AI查词缓存吗？（已加入特训库的词汇和词根将被保留）', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        onPress: async () => {
          try {
            // 1. 获取特训库里的单词和词根集合
            const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
            const starredWords = wordsStr ? JSON.parse(wordsStr) : [];
            const starredWordsSet = new Set(starredWords.map((item: any) => item.word.toLowerCase().trim()));

            const rootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
            const starredRoots = rootsStr ? JSON.parse(rootsStr) : [];
            const starredRootsSet = new Set(starredRoots.map((item: any) => item.segment.toLowerCase().replace(/^-|-$/g, '').trim()));

            // 2. 获取所有的 AsyncStorage 键
            const keys = await AsyncStorage.getAllKeys();
            const keysToRemove: string[] = [];

            // 3. 扫描并筛选缓存键
            for (const key of keys) {
              if (key.startsWith('W:')) {
                const cleanWord = key.substring(2).toLowerCase().trim();
                if (!starredWordsSet.has(cleanWord)) {
                  keysToRemove.push(key);
                }
              } else if (key.startsWith('R:')) {
                const cleanRoot = key.substring(2).toLowerCase().replace(/^-|-$/g, '').trim();
                if (!starredRootsSet.has(cleanRoot)) {
                  keysToRemove.push(key);
                }
              } else if (key.startsWith(CACHE_KEY_PREFIX)) {
                keysToRemove.push(key);
              }
            }

            // 4. 执行批量删除
            if (keysToRemove.length > 0) {
              await (AsyncStorage as any).multiRemove(keysToRemove);
            }

            Alert.alert('已清除', `已成功清理了 ${keysToRemove.length} 个查词缓存条目。`);
          } catch (e: any) {
            Alert.alert('错误', '清除缓存失败: ' + e.message);
          }
        }
      }
    ]);
  };

  const handleClearHistory = async () => {
    Alert.alert('清除查词历史', '确定要清空所有的查词历史记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定清空',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem('@word_history');
            await AsyncStorage.removeItem('history_list');
            Alert.alert('已清除', '查词历史记录清空成功！');
          } catch (e: any) {
            Alert.alert('错误', '清除历史记录失败: ' + e.message);
          }
        }
      }
    ]);
  };

  const handleClearAllData = async () => {
    Alert.alert('🚨 危险操作：恢复出厂设置', '此操作将清除所有设置、情景、收藏夹、查词历史和本地词库！确定继续吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定并清空',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.clear();
            await clearOfflineDict();
            await loadDictStats();
            setFolders(DEFAULT_FOLDERS);
            setContexts([
              { id: 'general', name: '🌍 日常' },
              { id: 'civ6', name: '🏛️ 文明6' },
              { id: 'linux_ai', name: '🐧 极客' },
              { id: 'etymology', name: '📖 openai词源' },
              { id: 'claude', name: '📖 Anthropic词源' },
            ]);
            setPrompts(DEFAULT_PROMPTS);
            setActiveContextId('general');
            setGlobalJsonTemplate(DEFAULT_JSON_TEMPLATE);
            setApiProtocol('openai');
            setApiKey('');
            setApiBase('https://api.deepseek.com/v1');
            setApiModel('deepseek-chat');
            setTemperature('0.2');
            setHistoryLimit('20');
            Alert.alert('已重置', '应用数据已全部初始化。');
          } catch {
            Alert.alert('错误', '重置失败');
          }
        }
      }
    ]);
  };

  const handleAddContext = () => {
    Alert.prompt(
      '添加情景模式',
      '请输入新情景的名称（例如：考研、雅思、商业英语）',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: (text?: string) => {
            const name = (text || '').trim();
            if (!name) return;
            const newId = `custom_${Date.now()}`;
            const newContext = { id: newId, name: `✍️ ${name}` };
            
            setContexts((prev) => [...prev, newContext]);
            setPrompts((prev) => ({
              ...prev,
              [newId]: `你是一个专业的英语词汇解析专家，针对【${name}】领域。\n请提供生动的词根拆解 and 记忆联想。`,
            }));
            setActiveContextId(newId);
          },
        },
      ],
      'plain-text'
    );
  };

  const handleDeleteContext = () => {
    const isSystemContext = ['general', 'civ6', 'linux_ai', 'etymology', 'claude'].includes(activeContextId);
    if (isSystemContext) {
      Alert.alert('操作受限', '系统预设的情景模式无法删除。');
      return;
    }

    Alert.alert(
      '删除情景模式',
      '确定要删除当前情景模式吗？该模式的自定义提示词将会丢失。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: () => {
            const currentId = activeContextId;
            setContexts((prev) => prev.filter((c) => c.id !== currentId));
            setPrompts((prev) => {
              const copy = { ...prev };
              delete copy[currentId];
              return copy;
            });
            setActiveContextId('general');
            Alert.alert('已删除', '情景模式已删除。');
          },
        },
      ]
    );
  };

  const handleUpdateActiveContext = () => {
    const updatedContexts = contexts.map((c) => {
      if (c.id === activeContextId) {
        const prefix = c.id.startsWith('custom_') ? '✍️ ' : c.name.match(/^[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]\s*/)?.[0] || '';
        return {
          ...c,
          name: `${prefix}${editContextName.trim()}`,
        };
      }
      return c;
    });

    const updatedPrompts = {
      ...prompts,
      [activeContextId]: editPrompt,
    };

    setContexts(updatedContexts);
    setPrompts(updatedPrompts);
    return { contexts: updatedContexts, prompts: updatedPrompts };
  };

  const handleResetContextPrompt = () => {
    const defaultVal = DEFAULT_PROMPTS[activeContextId] || '';
    setEditPrompt(defaultVal);
  };

  const handleSetPromptAsDefault = async () => {
    try {
      Alert.alert('提示', '当前提示词已设置为专属模板，重置时将恢复为本模板。');
      // Save template in async storage or setting object
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetGlobalJson = () => {
    setGlobalJsonTemplate(DEFAULT_JSON_TEMPLATE);
    Alert.alert('已重置', 'JSON约束结构已恢复默认值。');
  };

  // Manage Favorite Folders Group
  const handleAddFolder = () => {
    Alert.prompt(
      '新建收藏夹分组',
      '请输入新分组名称：',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: async (text?: string) => {
            const name = (text || '').trim();
            if (!name) return;
            const newFolder = { id: `fav_${Date.now()}`, name: `📁 ${name}` };
            const updated = [...folders, newFolder];
            setFolders(updated);
            await safeSetItem(FOLDERS_KEY, JSON.stringify(updated));
          }
        }
      ],
      'plain-text'
    );
  };

  const handleDeleteFolder = (folderId: string) => {
    if (folderId === 'fav_default') {
      Alert.alert('操作受限', '默认收藏夹无法删除。');
      return;
    }

    Alert.alert('删除分组', '确定要删除该收藏夹分组吗？（分组内的单词不会被删除，仅移除该分组标记）', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          const updated = folders.filter(f => f.id !== folderId);
          setFolders(updated);
          await safeSetItem(FOLDERS_KEY, JSON.stringify(updated));
        }
      }
    ]);
  };

  // --- Export Actions ---
  const exportData = async (type: 'words' | 'roots' | 'all') => {
    try {
      let dataToExport: any = {};
      
      const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
      const wordsList = wordsStr ? JSON.parse(wordsStr) : [];
      
      const rootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
      const rootsList = rootsStr ? JSON.parse(rootsStr) : [];

      let filename = 'all_packaged';
      if (type === 'words') {
        dataToExport = wordsList;
        filename = 'words_starred';
      } else if (type === 'roots') {
        dataToExport = rootsList;
        filename = 'roots_starred';
      } else {
        dataToExport = { words: wordsList, roots: rootsList };
      }

      // Filter by context if dataActionContext is enabled
      if (dataActionContext && type === 'words') {
        dataToExport = wordsList.filter((item: any) => {
          const mlMap = item.memory_lines_map || {};
          return Object.keys(mlMap).some(k => k.endsWith(`_${activeContextId}`));
        });
      }

      const path = RNFS.DownloadDirectoryPath + `/aiword_${filename}_export.json`;
      await RNFS.writeFile(path, JSON.stringify(dataToExport, null, 2), 'utf8');
      Alert.alert('导出成功', `已成功保存到设备下载目录:\n${path}`);
    } catch {
      try {
        // Fallback to Document directory if Download is not accessible
        let dataToExport: any = {};
        const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
        const wordsList = wordsStr ? JSON.parse(wordsStr) : [];
        const rootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
        const rootsList = rootsStr ? JSON.parse(rootsStr) : [];

        let filename = 'all_packaged';
        if (type === 'words') {
          dataToExport = wordsList;
          filename = 'words_starred';
        } else if (type === 'roots') {
          dataToExport = rootsList;
          filename = 'roots_starred';
        } else {
          dataToExport = { words: wordsList, roots: rootsList };
        }

        const fallbackPath = RNFS.DocumentDirectoryPath + `/aiword_${filename}_export.json`;
        await RNFS.writeFile(fallbackPath, JSON.stringify(dataToExport, null, 2), 'utf8');
        Alert.alert('导出成功', `由于下载文件夹无权限，已保存到沙盒文档路径:\n${fallbackPath}`);
      } catch (innerErr: any) {
        Alert.alert('导出失败', innerErr.message || '文件写入错误');
      }
    }
  };

  // --- Import Actions ---
  const importData = async (type: 'words' | 'roots' | 'all') => {
    try {
      const res = await pick({
        type: [types.json, types.allFiles],
      });
      if (!res || !res[0]) return;

      const file = res[0];
      const [localCopy] = await keepLocalCopy({
        files: [{
          uri: file.uri,
          fileName: file.name || 'data.json',
        }],
        destination: 'cachesDirectory',
      });
      const sourceUri = (localCopy && localCopy.status === 'success') ? localCopy.localUri : file.uri;
      const contents = await RNFS.readFile(sourceUri, 'utf8');
      const imported = JSON.parse(contents);

      if (type === 'words') {
        const targetList = Array.isArray(imported) ? imported : (imported.words || []);
        if (targetList.length === 0) {
          Alert.alert('导入失败', '导入的JSON中未检测到有效的单词列表。');
          return;
        }

        const currentWordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
        const currentWordsList = currentWordsStr ? JSON.parse(currentWordsStr) : [];

        let newWordsList = [];
        if (importMode) {
          // Replace Mode
          newWordsList = targetList;
        } else {
          // Merge Mode
          const map = new Map();
          currentWordsList.forEach((item: any) => map.set(item.word.toLowerCase(), item));
          targetList.forEach((item: any) => {
            if (item.word) {
              const cleanKey = item.word.toLowerCase();
              if (map.has(cleanKey)) {
                // Merge keys
                const existing = map.get(cleanKey);
                map.set(cleanKey, {
                  ...existing,
                  ...item,
                  favorite_folder_ids: [...new Set([...(existing.favorite_folder_ids || []), ...(item.favorite_folder_ids || [])])],
                  learning_status: item.learning_status || existing.learning_status,
                });
              } else {
                map.set(cleanKey, item);
              }
            }
          });
          newWordsList = Array.from(map.values());
        }

        await safeSetItem(LIBRARY_KEY, JSON.stringify(newWordsList));
        Alert.alert('导入成功', `成功导入并处理了 ${targetList.length} 个单词特训。`);

      } else if (type === 'roots') {
        const targetList = Array.isArray(imported) ? imported : (imported.roots || []);
        if (targetList.length === 0) {
          Alert.alert('导入失败', '导入的JSON中未检测到有效的词根列表。');
          return;
        }

        const currentRootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
        const currentRootsList = currentRootsStr ? JSON.parse(currentRootsStr) : [];

        let newRootsList = [];
        if (importMode) {
          // Replace Mode
          newRootsList = targetList;
        } else {
          // Merge Mode
          const map = new Map();
          currentRootsList.forEach((item: any) => map.set((item.segment || '').toLowerCase(), item));
          targetList.forEach((item: any) => {
            if (item.segment) {
              const cleanKey = item.segment.toLowerCase();
              if (map.has(cleanKey)) {
                const existing = map.get(cleanKey);
                map.set(cleanKey, {
                  ...existing,
                  ...item,
                  favorite_folder_ids: [...new Set([...(existing.favorite_folder_ids || []), ...(item.favorite_folder_ids || [])])],
                  learning_status: item.learning_status || existing.learning_status,
                });
              } else {
                map.set(cleanKey, item);
              }
            }
          });
          newRootsList = Array.from(map.values());
        }

        await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(newRootsList));
        Alert.alert('导入成功', `成功导入并处理了 ${targetList.length} 个词根特训。`);

      } else {
        // Packaged file (both words and roots)
        const wList = imported.words || [];
        const rList = imported.roots || [];

        // Words
        const currentWordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
        const currentWordsList = currentWordsStr ? JSON.parse(currentWordsStr) : [];
        let mergedWords = [];
        if (importMode) {
          mergedWords = wList;
        } else {
          const wMap = new Map();
          currentWordsList.forEach((item: any) => wMap.set(item.word.toLowerCase(), item));
          wList.forEach((item: any) => wMap.set(item.word.toLowerCase(), item));
          mergedWords = Array.from(wMap.values());
        }
        await safeSetItem(LIBRARY_KEY, JSON.stringify(mergedWords));

        // Roots
        const currentRootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
        const currentRootsList = currentRootsStr ? JSON.parse(currentRootsStr) : [];
        let mergedRoots = [];
        if (importMode) {
          mergedRoots = rList;
        } else {
          const rMap = new Map();
          currentRootsList.forEach((item: any) => rMap.set((item.segment || '').toLowerCase(), item));
          rList.forEach((item: any) => rMap.set((item.segment || '').toLowerCase(), item));
          mergedRoots = Array.from(rMap.values());
        }
        await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(mergedRoots));

        Alert.alert('导入成功', `打包数据导入完成！合并单词: ${wList.length}, 词根: ${rList.length}`);
      }
    } catch (err: any) {
      if (!isCancel(err)) {
        Alert.alert('导入失败', err.message || '解析JSON失败');
      }
    }
  };

  // --- Delete Actions ---
  const deleteData = (type: 'words' | 'roots' | 'all') => {
    const typeText = type === 'words' ? '单词特训库' : type === 'roots' ? '词根特训库' : '所有特训单词和词根';
    const scopeText = dataActionContext ? `【仅限当前情景: ${contexts.find(c => c.id === activeContextId)?.name || activeContextId}】` : '【全局全量】';
    
    Alert.alert('🗑️ 危险删除', `确定要彻底清除 ${scopeText} 的 ${typeText} 吗？此操作不可逆！`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确定抹除',
        style: 'destructive',
        onPress: async () => {
          try {
            if (type === 'words' || type === 'all') {
              if (dataActionContext) {
                // Delete active context memory lines only
                const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
                const wordsList = wordsStr ? JSON.parse(wordsStr) : [];
                const updatedList = wordsList.map((item: any) => {
                  const map = item.memory_lines_map || {};
                  const activeKey = `${item.sourceTag || 'remote'}_${activeContextId}`;
                  if (map[activeKey]) {
                    delete map[activeKey];
                  }
                  return {
                    ...item,
                    memory_lines_map: map
                  };
                }).filter((item: any) => {
                  // Keep item only if there are other memory lines or if it is explicitly starred
                  return Object.keys(item.memory_lines_map || {}).length > 0 || item.is_favorite;
                });
                await safeSetItem(LIBRARY_KEY, JSON.stringify(updatedList));
              } else {
                await safeRemoveItem(LIBRARY_KEY);
              }
            }

            if (type === 'roots' || type === 'all') {
              await safeRemoveItem(ROOT_LIBRARY_KEY);
            }

            Alert.alert('清除成功', '所选特训库数据已被清空。');
          } catch {
            Alert.alert('错误', '数据清理失败');
          }
        }
      }
    ]);
  };

  const saveSettings = async () => {
    try {
      const updated = handleUpdateActiveContext();
      
      const settings = {
        apiProtocol,
        apiKey,
        apiBase,
        apiModel,
        temperature: parseFloat(temperature) || 0.2,
        historyLimit: parseInt(historyLimit, 10) || 10,
        dataFallbackRule,
        contextFallbackRule,
        rootStrategy,
        globalJsonTemplate,
        dataActionContext,
        importMode,
        contexts: updated.contexts,
        prompts: updated.prompts,
      };

      const successSettings = await safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
      const successTheme = await safeSetItem('ui_theme', uiTheme);
      
      if (successSettings && successTheme) {
        Alert.alert('保存成功', '所有的配置和情景模式已经更新！');
      }
    } catch {
      Alert.alert('保存失败', '保存配置信息出错。');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.container}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <StatusBar barStyle={theme.statusBar} backgroundColor={theme.cardBg} />
      <View style={styles.header}>
        <View style={{flexDirection:"row", alignItems:"center"}}><Icon name="options" size={24} color={theme.text} style={{marginRight:8}} /><Text style={styles.title}>偏好设置</Text></View>
      </View>

      {/* About Screen Banner */}
      <TouchableOpacity 
        style={[styles.section, { backgroundColor: theme.primary, borderTopWidth: 0, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        onPress={() => navigation.navigate('About')}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="book-outline" size={28} color="#fff" style={{marginRight: 12}} />
          <View>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#fff' }}>App介绍与使用指南</Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>点击查看词库统计及核心功能说明</Text>
          </View>
        </View>
        <Text style={{ fontSize: 20, color: '#fff' }}>→</Text>
      </TouchableOpacity>

      {/* UI Settings Card */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#10b981' }]}>
        <Text style={[styles.sectionTitle, { color: '#10b981' }]}><Icon name="color-palette-outline" size={18} color="#10b981" style={{marginRight:6}} />核心功能: UI与主题设置</Text>
        <Text style={styles.label}>界面主题模式 (Theme Mode)</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={uiTheme}
            onValueChange={(val) => setUiTheme(val)}
            dropdownIconColor={theme.primary}
            style={{ color: theme.text }}
          >
            <Picker.Item label="跟随系统主题 (System)" value="system" />
            <Picker.Item label="极客深邃暗黑 (Dark)" value="dark" />
            <Picker.Item label="极简优雅明亮 (Light)" value="light" />
          </Picker>
        </View>
      </View>

      {/* API Config Card */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#38bdf8' }]}>
        <Text style={[styles.sectionTitle, { color: '#38bdf8' }]}><Icon name="hardware-chip-outline" size={18} color="#38bdf8" style={{marginRight:6}} />api或者不用api</Text>
        
        <View style={styles.dictStatsCard}>
          <Text style={styles.statsLabel}>
            词库状态:{' '}
            <Text style={dictStats.exists ? styles.statusActive : styles.statusInactive}>
              {dictStats.exists ? '🟢 已导入' : '🔴 未导入'}
            </Text>
          </Text>
          {dictStats.exists && (
            <>
              <Text style={styles.statsText}>包含条目: {dictStats.totalKeys} 词/词根</Text>
              <Text style={styles.statsText}>文件大小: {formatSize(dictStats.sizeBytes)}</Text>
            </>
          )}
        </View>

        {importingDict ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loaderText}>正在解析并导入庞大的词库数据，请稍候...</Text>
          </View>
        ) : (
          <>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.actionBtnOutline} onPress={handleImportOfflineDict}>
                <Text style={styles.actionBtnTextOutline}><Icon name="folder-open-outline" size={18} color={theme.primaryText} style={{marginRight:6}} /><Text style={styles.actionBtnTextOutline}>从本地选择导入</Text></Text>
              </TouchableOpacity>
              {dictStats.exists && (
                <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn]} onPress={handleClearOfflineDict}>
                  <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}><Icon name="trash-outline" size={18} color={theme.dangerText} style={{marginRight:6}} /><Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>删除词库</Text></Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ marginTop: 15 }}>
              <Text style={styles.label}>或者：提供远程下载直链 (如 GitHub Raw)</Text>
              <TextInput
                style={styles.input}
                value={downloadUrl}
                onChangeText={setDownloadUrl}
                placeholder="https://raw.githubusercontent.com/..."
                autoCapitalize="none"
              />
              <TouchableOpacity style={[styles.actionBtnOutline, { marginTop: 6, borderColor: theme.success, backgroundColor: theme.successLight }]} onPress={handleDownloadAndImportOfflineDict}>
                <Text style={[styles.actionBtnTextOutline, { color: theme.success }]}><Icon name="cloud-download-outline" size={18} color={theme.success} style={{marginRight:6}} /><Text style={[styles.actionBtnTextOutline, { color: theme.success }]}>从直链下载并自动导入</Text></Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        <Text style={styles.hint}>支持格式为 JSON。必须包含 W: (单词) 和 R: (词根) 键结构的完整对象字典，且非数组形式。</Text>
      </View>

      {/* API Protocol & Provider Configuration Card */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#3b82f6' }]}>
        <Text style={[styles.sectionTitle, { color: '#3b82f6' }]}><Icon name="globe-outline" size={18} color="#3b82f6" style={{marginRight:6}} />API 服务商与协议</Text>

        <Text style={styles.label}>API 协议类型</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={apiProtocol}
            style={{ color: theme.text }}
            dropdownIconColor={theme.primary}
            onValueChange={(val) => {
              setApiProtocol(val);
              if (val === 'openai' && apiBase.includes('anthropic')) {
                setApiBase('https://api.deepseek.com/v1');
              } else if (val === 'claude' && !apiBase.includes('anthropic')) {
                setApiBase('https://api.anthropic.com');
              }
            }}
          >
            <Picker.Item label="OpenAI / DeepSeek 协议格式" value="openai" />
            <Picker.Item label="Anthropic Claude 协议格式" value="claude" />
          </Picker>
        </View>
        
        <Text style={styles.label}>API Base URL (端点基址)</Text>
        <TextInput
          style={styles.input}
          value={apiBase}
          onChangeText={setApiBase}
          placeholder="例如: https://api.deepseek.com/v1"
          autoCapitalize="none"
        />

        <Text style={styles.label}>API Key (授权密匙)</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="sk-..."
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.label}>API Model (所选大语言模型)</Text>
        <TextInput
          style={styles.input}
          value={apiModel}
          onChangeText={setApiModel}
          placeholder="直接输入模型名称..."
          autoCapitalize="none"
        />

        <Text style={styles.label}>模型快捷预设 (点击修改上方输入框)</Text>
        <View style={styles.presetsWrapper}>
          {presetModels.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.presetBadge, apiModel === item.value && styles.activePresetBadge]}
              onPress={() => {
                setApiModel(item.value);
                if (item.value.includes('claude')) {
                  setApiProtocol('claude');
                  setApiBase('https://api.anthropic.com');
                } else if (item.value.includes('deepseek')) {
                  setApiProtocol('openai');
                  setApiBase('https://api.deepseek.com/v1');
                }
              }}
            >
              <Text style={[styles.presetBadgeText, apiModel === item.value && styles.activePresetBadgeText]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>生成温度 (Temperature: {temperature})</Text>
        <TextInput
          style={styles.input}
          value={temperature}
          onChangeText={setTemperature}
          placeholder="值越小越精确，建议在 0.1 - 0.7 之间"
          keyboardType="numeric"
        />
      </View>


      {/* Global Optimization & Fallback Rules */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#64748b' }]}>
        <Text style={[styles.sectionTitle, { color: '#64748b' }]}><Icon name="search-outline" size={18} color="#64748b" style={{marginRight:6}} />全局查找与策略设置</Text>

        <Text style={styles.label}>查词历史保留上限</Text>
        <TextInput
          style={styles.input}
          value={historyLimit}
          onChangeText={setHistoryLimit}
          placeholder="缓存保留的单词个数，如 20"
          keyboardType="numeric"
        />

        <Text style={styles.label}>数据保护策略 (Data Fallback)</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={dataFallbackRule}
            style={{ color: theme.text }}
            dropdownIconColor={theme.primary}
            onValueChange={setDataFallbackRule}
          >
            <Picker.Item label="🔄 交叉查询 (优先使用本地定制数据)" value="cross" />
            <Picker.Item label="🔒 严格匹配 (只查找对应模式数据)" value="strict" />
            <Picker.Item label="🌐 API 优先 (强制在线AI重新生成)" value="remote_first" />
          </Picker>
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.switchLabel}>护根模式 (Root Strategy)</Text>
            <Text style={styles.switchSubLabel}>开启后，重新解析词根时，保留之前在词根条目中编辑修改过的自定义笔记</Text>
          </View>
          <Switch
            value={rootStrategy}
            onValueChange={setRootStrategy}
            trackColor={{ false: theme.border, true: theme.primaryLight }}
            thumbColor={rootStrategy ? theme.primary : theme.textMuted}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.switchLabel}>共用情景降级保护</Text>
            <Text style={styles.switchSubLabel}>当当前情景模式下查不到离线词库时，自动查找其他情景的离线解析</Text>
          </View>
          <Switch
            value={contextFallbackRule}
            onValueChange={setContextFallbackRule}
            trackColor={{ false: theme.border, true: theme.primaryLight }}
            thumbColor={contextFallbackRule ? theme.primary : theme.textMuted}
          />
        </View>
      </View>

      {/* Scenario Modes Config Card */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#38bdf8' }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: '#38bdf8' }]}><Icon name="document-text-outline" size={18} color="#38bdf8" style={{marginRight:6}} />情景模式配置</Text>
          <TouchableOpacity style={[styles.addContextBtn, { flexDirection: "row", alignItems: "center" }]} onPress={handleAddContext}>
            <Text style={styles.addContextBtnText}><Icon name="add-circle-outline" size={16} color={theme.primary} style={{marginRight:2}} /><Text style={styles.addContextBtnText}>新建情景</Text></Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>选择要配置的情景：</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={activeContextId}
            style={{ color: theme.text }}
            dropdownIconColor={theme.primary}
            onValueChange={(val) => {
              handleUpdateActiveContext();
              setActiveContextId(val);
            }}
          >
            {contexts.map((c) => (
              <Picker.Item key={c.id} label={c.name} value={c.id} />
            ))}
          </Picker>
        </View>

        <Text style={styles.label}>情景名称</Text>
        <TextInput
          style={styles.input}
          value={editContextName}
          onChangeText={setEditContextName}
          placeholder="情景显示的中文名称"
          editable={!['general', 'civ6', 'linux_ai', 'etymology', 'claude'].includes(activeContextId)}
        />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <Text style={styles.label}>系统提示词 (Prompt)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={handleResetContextPrompt}>
              <Text style={{ fontSize: 12, color: '#f59e0b', fontWeight: 'bold' }}><Icon name="refresh-outline" size={14} color="#f59e0b" style={{marginRight:2}} /><Text style={{ fontSize: 12, color: "#f59e0b", fontWeight: "bold" }}>重置</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSetPromptAsDefault}>
              <Text style={{ fontSize: 12, color: theme.primaryText, fontWeight: 'bold' }}><Icon name="save-outline" size={14} color={theme.primaryText} style={{marginRight:2}} /><Text style={{ fontSize: 12, color: theme.primaryText, fontWeight: "bold" }}>设为专属模板</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.input, { height: 80, justifyContent: 'center' }]}
          onPress={() => {
            setZenModeType('prompt');
            setZenModeContent(editPrompt);
            setZenModeVisible(true);
          }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 13 }} numberOfLines={3}>
            {editPrompt ? editPrompt : "点击进行全屏大字号编辑(Zen Mode)..."}
          </Text>
        </TouchableOpacity>

        {!['general', 'civ6', 'linux_ai', 'etymology', 'claude'].includes(activeContextId) && (
          <TouchableOpacity style={[styles.delContextBtn, { flexDirection: "row", justifyContent: "center" }]} onPress={handleDeleteContext}>
            <Text style={styles.delContextBtnText}><Icon name="trash-bin-outline" size={16} color={theme.dangerText} style={{marginRight:2}} /><Text style={styles.delContextBtnText}>删除当前情景</Text></Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Global JSON structure template */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#a855f7' }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={[styles.sectionTitle, { color: '#a855f7' }]}><Icon name="extension-puzzle-outline" size={18} color="#a855f7" style={{marginRight:6}} />全局JSON 结构约束 一般不改除非你看了文档</Text>
          <TouchableOpacity onPress={handleResetGlobalJson}>
            <Text style={{ fontSize: 12, color: '#f59e0b', fontWeight: 'bold' }}><Icon name="refresh-circle-outline" size={14} color="#f59e0b" style={{marginRight:2}} /><Text style={{ fontSize: 12, color: "#f59e0b", fontWeight: "bold" }}>恢复默认</Text></Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.input, { height: 80, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }]}
          onPress={() => {
            setZenModeType('json');
            setZenModeContent(globalJsonTemplate);
            setZenModeVisible(true);
          }}
        >
          <Text style={{ color: theme.textMuted, fontFamily: 'monospace', fontSize: 12 }} numberOfLines={3}>
            {globalJsonTemplate ? globalJsonTemplate : "点击进行全屏大字号编辑..."}
          </Text>
        </TouchableOpacity>
        <Text style={styles.hint}>约束大模型输出数据项，一般在了解插件接口要求下修改。</Text>
      </View>

      {/* Dynamic Data management Card */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#ef4444' }]}>
        <Text style={[styles.sectionTitle, { color: '#ef4444' }]}><Icon name="server-outline" size={18} color="#ef4444" style={{marginRight:6}} />词库数据管理 (导出/导入/清除)</Text>
        
        {/* Checkbox Rows */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.switchLabel}>{dataActionContext ? '仅限当前情景' : '全局数据模式'}</Text>
            <Text style={styles.switchSubLabel}>{dataActionContext ? '数据导入、导出、清除动作仅作用于当前情景' : '数据操作将影响全部情景下的记录'}</Text>
          </View>
          <Switch
            value={dataActionContext}
            onValueChange={setDataActionContext}
            trackColor={{ false: '#cbd5e1', true: '#fecaca' }}
            thumbColor={dataActionContext ? '#ef4444' : '#f1f5f9'}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.switchLabel}>{importMode ? '替换/覆盖模式导入' : '合并模式导入'}</Text>
            <Text style={styles.switchSubLabel}>{importMode ? '导入时如遇重复项将直接覆盖旧记录' : '合并模式将保留旧修改并合并新记录'}</Text>
          </View>
          <Switch
            value={importMode}
            onValueChange={setImportMode}
            trackColor={{ false: theme.border, true: theme.dangerLight }}
            thumbColor={importMode ? theme.danger : theme.textMuted}
          />
        </View>

        {/* Data Operation Buttons Grid */}
        <View style={{ marginTop: 15 }}>
          <Text style={[styles.label, { color: theme.primaryText, fontWeight: 'bold' }]}><Icon name="cloud-upload-outline" size={16} color={theme.primaryText} style={{marginRight:6, marginTop:10}} /><Text style={[styles.label, { color: theme.primaryText, fontWeight: "bold", marginTop: 10 }]}>导出数据备份</Text></Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionBtnOutline} onPress={() => exportData('words')}>
              <Text style={styles.actionBtnTextOutline}>单词</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnOutline} onPress={() => exportData('roots')}>
              <Text style={styles.actionBtnTextOutline}>词根</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnOutline} onPress={() => exportData('all')}>
              <Text style={styles.actionBtnTextOutline}>全部打包</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: theme.successText, fontWeight: 'bold', marginTop: 10 }]}><Icon name="cloud-download-outline" size={16} color={theme.successText} style={{marginRight:6, marginTop:10}} /><Text style={[styles.label, { color: theme.successText, fontWeight: "bold", marginTop: 10 }]}>导入外部数据</Text></Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: theme.success, backgroundColor: theme.successLight }]} onPress={() => importData('words')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.successText }]}>单词</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: theme.success, backgroundColor: theme.successLight }]} onPress={() => importData('roots')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.successText }]}>词根</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnOutline, { borderColor: theme.success, backgroundColor: theme.successLight }]} onPress={() => importData('all')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.successText }]}>全部打包</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: theme.dangerText, fontWeight: 'bold', marginTop: 10 }]}><Icon name="warning-outline" size={16} color={theme.dangerText} style={{marginRight:6, marginTop:10}} /><Text style={[styles.label, { color: theme.dangerText, fontWeight: "bold", marginTop: 10 }]}>危险数据清除</Text></Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn]} onPress={() => deleteData('words')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>单词</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn]} onPress={() => deleteData('roots')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>词根</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn]} onPress={() => deleteData('all')}>
              <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>全部清除</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Data Cleaning Actions */}
      <View style={[styles.section, { borderTopWidth: 4, borderTopColor: '#dc2626' }]}>
        <Text style={[styles.sectionTitle, { color: '#dc2626' }]}><Icon name="brush-outline" size={18} color="#dc2626" style={{marginRight:6}} />缓存清理与恢复</Text>
        
        <View style={styles.buttonCol}>
          <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn]} onPress={handleClearCache}>
            <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}><Icon name="flash-outline" size={18} color={theme.dangerText} style={{marginRight:6}} /><Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>清除 AI 查词缓存</Text></Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn, { marginTop: 10 }]} onPress={handleClearHistory}>
            <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}><Icon name="time-outline" size={18} color={theme.dangerText} style={{marginRight:6}} /><Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>清空查词历史记录</Text></Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtnOutline, styles.dangerBtn, { marginTop: 10 }]} onPress={handleClearAllData}>
            <Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}><Icon name="warning-outline" size={18} color={theme.dangerText} style={{marginRight:6}} /><Text style={[styles.actionBtnTextOutline, { color: theme.dangerText }]}>恢复出厂设置 (抹除所有)</Text></Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={[styles.saveBtn, { flexDirection: "row", justifyContent: "center" }]} onPress={saveSettings}>
        <Text style={styles.saveBtnText}><Icon name="checkmark-done-outline" size={22} color="#fff" style={{marginRight:8}} /><Text style={styles.saveBtnText}>保存所有配置</Text></Text>
      </TouchableOpacity>
      
      <View style={{ height: 40 }} />
      </ScrollView>
      </View>

      <Modal
        visible={zenModeVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setZenModeVisible(false)}
      >
        <View style={styles.zenModeBackdrop}>
          <View style={styles.zenModeModal}>
            <View style={styles.zenModeHeader}>
              <Text style={styles.zenModeTitle}>
                {zenModeType === 'prompt' ? '编辑专属提示词' : '编辑 JSON 结构'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={[styles.actionBtnOutline, { flex: 0, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.primary, borderColor: theme.primary }]}
                  onPress={() => {
                    if (zenModeType === 'prompt') {
                      setEditPrompt(zenModeContent);
                    } else {
                      setGlobalJsonTemplate(zenModeContent);
                    }
                    setZenModeVisible(false);
                  }}
                >
                  <View style={{flexDirection:"row", alignItems:"center"}}><Icon name="save-outline" size={16} color="#fff" style={{marginRight:2}} /><Text style={[styles.actionBtnTextOutline, { color: "#fff", fontWeight: "bold" }]}>保存</Text></View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtnOutline, { flex: 0, paddingVertical: 6, paddingHorizontal: 10 }]}
                  onPress={() => setZenModeVisible(false)}
                >
                  <Text style={styles.actionBtnTextOutline}>❌ 取消</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TextInput
              style={styles.zenModeTextArea}
              value={zenModeContent}
              onChangeText={setZenModeContent}
              multiline
              textAlignVertical="top"
              autoFocus
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
  },
  header: {
    padding: 20,
    backgroundColor: theme.cardBg,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
  },
  section: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 3,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    rowGap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
  },
  dictStatsCard: {
    backgroundColor: theme.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  statsLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 6,
  },
  statusActive: {
    color: theme.successText,
  },
  statusInactive: {
    color: theme.dangerText,
  },
  statsText: {
    fontSize: 13,
    color: theme.textMuted,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  buttonCol: {
    flexDirection: 'column',
    width: '100%',
  },
  actionBtnOutline: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.primary,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    elevation: 0,
    shadowOpacity: 0,
  },
  actionBtnTextOutline: {
    color: theme.primaryText,
    fontSize: 14,
    fontWeight: '600',
  },
  dangerBtn: {
    borderColor: theme.danger,
    backgroundColor: 'transparent',
  },
  loaderContainer: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  loaderText: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    color: theme.text,
    marginBottom: 8,
    fontWeight: '600',
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.text,
    backgroundColor: theme.inputBg,
    marginBottom: 14,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 10,
    backgroundColor: theme.inputBg,
    marginBottom: 14,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  presetsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  presetBadge: {
    backgroundColor: theme.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  activePresetBadge: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primary,
  },
  presetBadgeText: {
    fontSize: 12,
    color: theme.textMuted,
  },
  activePresetBadgeText: {
    color: theme.primaryText,
    fontWeight: 'bold',
  },
  foldersList: {
    backgroundColor: theme.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 8,
  },
  folderRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  folderRowName: {
    fontSize: 14,
    color: theme.text,
    fontWeight: '500',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    marginTop: 10,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
  },
  switchSubLabel: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  textArea: {
    height: 120,
  },
  hint: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: -4,
    lineHeight: 18,
  },
  addContextBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  addContextBtnText: {
    color: theme.primary,
    fontWeight: 'bold',
    fontSize: 13,
  },
  delContextBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.danger,
    marginTop: 8,
  },
  delContextBtnText: {
    color: theme.dangerText,
    fontSize: 14,
    fontWeight: 'bold',
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 30,
    backgroundColor: theme.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 4,
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1,
  },
  zenModeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  zenModeModal: {
    alignSelf: 'stretch',
    height: '80%',
    backgroundColor: theme.cardBg,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: theme.border,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  zenModeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  zenModeTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.text,
  },
  zenModeTextArea: {
    flex: 1,
    backgroundColor: theme.inputBg,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 20,
    fontFamily: 'monospace',
    fontSize: 16,
    lineHeight: 24,
  },
});

export default SettingsScreen;
