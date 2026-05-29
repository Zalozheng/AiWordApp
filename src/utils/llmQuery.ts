import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryOfflineWord, getWordTreeData, WordTreeData } from './offlineDict';
import { safeSetItem } from './storage';

const SETTINGS_KEY = '@app_settings';

export interface Part {
  segment: string;
  type: string;
  meaning: string;
  deep_origin: string;
  derivatives: string[];
}

export interface WordData {
  word: string;
  display_breakdown: string;
  phonetic_us: string;
  primary_meaning: string;
  noun_source: string;
  parts: Part[];
  memory_lines: string[];
  memory_lines_map?: Record<string, string[]>;
  edited_keys?: string[];
  lookup_count?: number;
  updated_at?: number;
  sourceTag?: string;
  learning_status?: string | null;
  favorite_folder_ids?: string[];
  is_favorite?: boolean;
}

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
  general: '你是一个深谙"唯名词论"的日常英语词汇专家。\n请结合极其常见的生活、购物、交流场景进行解析。',
  civ6: '你是一个《文明6》(Civilization VI) 的资深游戏策划兼历史学家。\n请结合游戏中的科技树、尤里卡触发、世界奇观建设、政策卡组合、时代得分或兵种克制等核心游戏机制进行解析。',
  linux_ai: '你是一个极其硬核的 Linux 内核开发者兼 AI (CUDA/Ollama) 架构师。\n请结合Linux终端命令、C++底层内存管理、GPU显存分配、深度学习模型架构、或者极客黑客的计算机底层逻辑进行解析。',
  etymology: `你是一个英语词汇词源专家，你是一个深谙“唯名词论”的日常英语词汇专家。
请结合极其常见的生活、购物、交流场景进行解析。

当用户输入一个英文单词时：
如果你具有联网搜索能力，请先查询：
site:etymonline.com [单词]
获取真实词源拆解后，再按格式输出。
禁止凭记忆猜测词根，一律以真实词源为准。`,
  claude: `你是一个英语词汇词源专家，你是一个深谙“唯名词论”的日常英语词汇专家。
请结合极其常见的生活、购物、交流场景进行解析。`,
};

export const repairJsonString = (jsonStr: string): string => {
  let s = jsonStr.trim();
  // Strip code blocks if present
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (s.startsWith('```')) {
    s = s.substring(3).trim();
  }
  if (!s.startsWith('{')) {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) {
      s = match[0];
    }
  }
  return s;
};

export const parseLLMJson = (jsonStr: string): any => {
  const repaired = repairJsonString(jsonStr);
  try {
    return JSON.parse(repaired);
  } catch (e) {
    // Try regex-based quotation repair to fix unescaped double quotes inside values
    try {
      let fixed = repaired
        .replace(
          /("[\w_]+":\s*")([\s\S]*?)("(?=\s*[,}\n\r]))/g,
          (match: string, p1: string, p2: string, p3: string) => {
            if (p2.includes('": ')) return match;
            return p1 + p2.replace(/\\"/g, '[[TEMP]]').replace(/"/g, '\\"').replace(/\[\[TEMP\]\]/g, '\\"') + p3;
          }
        )
        .replace(
          /(\[\s*)([\s\S]*?)(\s*\])/g,
          (match: string, p1: string, p2: string, p3: string) => {
            if (p2.includes('{') || p2.includes('": ')) return match;
            return p1 + p2.replace(/("\s*)([\s\S]*?)("\s*(?=[,\]]|$))/g, 
              (m: string, m1: string, m2: string, m3: string) => m1 + m2.replace(/\\"/g, '[[TEMP]]').replace(/"/g, '\\"').replace(/\[\[TEMP\]\]/g, '\\"') + m3
            ) + p3;
          }
        )
        .replace(/"((?:[^"\\]|\\.)*)"/gs, (match: string, p1: string) => {
          return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
        })
        .replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(fixed);
    } catch (innerError) {
      console.error('Failed to parse LLM JSON even after repair', innerError);
      throw e; // throw original parse error
    }
  }
};

// Equivalent to background.js cache query logic
export const getCachedWord = async (
  word: string,
  engine: string,
  contextMode: string
): Promise<WordData | null> => {
  const cleanWord = word.trim().toLowerCase();
  const cachedStr = await AsyncStorage.getItem('W:' + cleanWord);
  if (!cachedStr) return null;

  const data: WordData = JSON.parse(cachedStr);
  if (!data.memory_lines_map) {
    data.memory_lines_map = {};
  }

  // Load app config for fallback rule
  const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
  const settings = settingsStr ? JSON.parse(settingsStr) : {};
  const fallbackRule = settings.dataFallbackRule || 'cross';
  const contextFallbackRule = settings.contextFallbackRule !== false;

  let activeEngine = engine === 'local' ? (settings.offlineSource || 'remote') : engine;
  if (activeEngine === 'api') activeEngine = 'remote';
  const activeKey = `${activeEngine}_${contextMode}`;
  const altEngine = activeEngine === 'remote' ? 'ollama' : 'remote';
  const altKey = `${altEngine}_${contextMode}`;

  let selectedLines: string[] | null = null;
  let sourceTag = activeEngine;

  if (fallbackRule === 'strict') {
    selectedLines = data.memory_lines_map[activeKey] || null;
  } else if (fallbackRule === 'cross') {
    if (data.memory_lines_map[activeKey]) {
      selectedLines = data.memory_lines_map[activeKey];
    } else if (data.memory_lines_map[altKey]) {
      selectedLines = data.memory_lines_map[altKey];
      sourceTag = altEngine;
    }
  } else if (fallbackRule === 'remote_first') {
    if (data.memory_lines_map[`remote_${contextMode}`]) {
      selectedLines = data.memory_lines_map[`remote_${contextMode}`];
      sourceTag = 'remote';
    } else if (data.memory_lines_map[`ollama_${contextMode}`]) {
      selectedLines = data.memory_lines_map[`ollama_${contextMode}`];
      sourceTag = 'ollama';
    }
  } else if (fallbackRule === 'ollama_first') {
    if (data.memory_lines_map[`ollama_${contextMode}`]) {
      selectedLines = data.memory_lines_map[`ollama_${contextMode}`];
      sourceTag = 'ollama';
    } else if (data.memory_lines_map[`remote_${contextMode}`]) {
      selectedLines = data.memory_lines_map[`remote_${contextMode}`];
      sourceTag = 'remote';
    }
  }

  if (selectedLines) {
    return {
      ...data,
      memory_lines: selectedLines,
      sourceTag: sourceTag === 'remote' ? 'api' : sourceTag,
    };
  }

  // If still not found, try contextFallbackRule
  if (contextFallbackRule) {
    const keys = Object.keys(data.memory_lines_map);
    let matchedKey = keys.find((k) => k.startsWith(activeEngine + '_'));
    if (!matchedKey) {
      matchedKey = keys[0];
    }
    if (matchedKey && data.memory_lines_map[matchedKey]) {
      const parsedEngine = matchedKey.split('_')[0];
      return {
        ...data,
        memory_lines: data.memory_lines_map[matchedKey],
        sourceTag: parsedEngine === 'remote' ? 'api' : parsedEngine,
      };
    }
  }

  // Return base memory lines if map is empty
  if (data.memory_lines && data.memory_lines.length > 0) {
    return {
      ...data,
      sourceTag: 'cache',
    };
  }

  return null;
};

// Fetch from API and save under extension-compatible W: and R: keys
export const fetchLLMForWord = async (
  word: string,
  forceRefresh: boolean = false,
  engine: string = 'api',
  contextMode: string = 'general'
): Promise<WordData> => {
  const cleanWord = word.trim().toLowerCase();
  
  // 1. Resolve Settings
  const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
  const settings = settingsStr ? JSON.parse(settingsStr) : {};
  
  const apiKey = settings.apiKey || '';
  const apiBase = settings.apiBase || 'https://api.deepseek.com/v1';
  const apiProtocol = settings.apiProtocol || 'openai';
  const apiModel = settings.apiModel || 'deepseek-chat';
  const temperature = settings.temperature !== undefined ? parseFloat(settings.temperature) : 0.2;
  const globalJsonTemplate = settings.globalJsonTemplate || '';
  const rootStrategy = settings.rootStrategy !== false; // keep_old by default

  // 2. Try Cache lookup first (if not forcing refresh)
  if (!forceRefresh) {
    if (engine === 'local') {
      const offlineResult = await queryOfflineWord(cleanWord, contextMode);
      if (offlineResult) {
        const cached = await getCachedWord(cleanWord, 'remote', contextMode);
        if (cached) return cached;
        return offlineResult as WordData;
      }
    } else {
      const cached = await getCachedWord(cleanWord, 'remote', contextMode);
      if (cached) {
        // Increment lookup count and save
        cached.lookup_count = (cached.lookup_count || 0) + 1;
        cached.updated_at = Date.now();
        await safeSetItem('W:' + cleanWord, JSON.stringify(cached));
        return cached;
      }
    }
  }

  if (engine === 'local') {
    throw new Error(`离线词典中未收录单词「${cleanWord}」，请切换为 API 在线模式。`);
  }

  if (!apiKey) {
    throw new Error('请前往「设置」页面配置 API Key 以便进行在线解析。');
  }

  // 3. Construct System Prompt
  const activePrompt = settings.prompts?.[contextMode] || DEFAULT_PROMPTS[contextMode] || DEFAULT_PROMPTS.general;
  const activeContext = settings.contexts?.find((c: any) => c.id === contextMode);
  const sceneName = activeContext ? activeContext.name : '极其常见的生活、购物、交流场景';
  
  let systemPrompt = activePrompt;
  if (!systemPrompt.includes('display_breakdown') && !systemPrompt.includes('primary_meaning')) {
    const jsonTemplate = globalJsonTemplate || DEFAULT_JSON_TEMPLATE;
    systemPrompt = `${systemPrompt}\n${jsonTemplate}`;
  }
  
  // Replace placeholders
  systemPrompt = systemPrompt.replace(/{CONTEXT}/g, sceneName);

  // 4. API Request Endpoint
  let requestUrl = apiBase.trim();
  if (apiProtocol === 'claude') {
    if (!requestUrl.includes('/v1/messages') && !requestUrl.includes('/messages')) {
      requestUrl = requestUrl.replace(/\/?$/, '') + '/v1/messages';
    }
  } else {
    if (!requestUrl.includes('/chat/completions')) {
      requestUrl = requestUrl.replace(/\/?$/, '') + '/chat/completions';
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (apiProtocol === 'claude') {
    headers['anthropic-version'] = '2023-06-01';
  }

  let requestBody: any;
  if (apiProtocol === 'claude') {
    requestBody = {
      model: apiModel || 'claude-3-5-sonnet-20240620',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: `请解析单词：${cleanWord}` }],
      temperature,
    };
  } else {
    requestBody = {
      model: apiModel || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请解析单词：${cleanWord}` }
      ],
      temperature,
      response_format: { type: 'json_object' }
    };
  }

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errJson: any;
    try {
      errJson = JSON.parse(errorText);
    } catch {
      errJson = { error: { message: `HTTP status ${response.status}: ${errorText}` } };
    }
    throw new Error(errJson.error?.message || `接口返回异常状态: ${response.status}`);
  }

  const resJson = await response.json();
  let content = '';
  if (apiProtocol === 'claude') {
    content = resJson.content?.[0]?.text || '';
  } else {
    content = resJson.choices?.[0]?.message?.content || '';
  }

  // 5. Parse and Normalize LLM Response JSON
  const parsedData = parseLLMJson(content);
  
  // Format word key
  const finalWord = (parsedData.word || cleanWord).toLowerCase().trim();
  const wordStorageKey = 'W:' + finalWord;

  // 6. Save root parts to AsyncStorage
  const existingWordStr = await AsyncStorage.getItem(wordStorageKey);
  const existingWord: WordData | null = existingWordStr ? JSON.parse(existingWordStr) : null;
  
  const savedParts: Part[] = [];

  for (const part of (parsedData.parts || [])) {
    if (!part.segment) continue;
    const cleanSegment = part.segment.toLowerCase().replace(/^-|-$/g, '').trim();
    const rootKey = 'R:' + cleanSegment;
    
    const existingRootStr = await AsyncStorage.getItem(rootKey);
    const existingRoot = existingRootStr ? JSON.parse(existingRootStr) : null;

    let updatedRoot = {
      segment: part.segment,
      type: part.type || '词根',
      meaning: part.meaning || '',
      deep_origin: part.deep_origin || '',
      derivatives: part.derivatives || [],
      lookup_count: existingRoot ? ((existingRoot.lookup_count || 0) + 1) : 1,
      updated_at: Date.now(),
      learning_status: existingRoot ? (existingRoot.learning_status || null) : null,
      favorite_folder_ids: existingRoot ? (existingRoot.favorite_folder_ids || []) : [],
      is_favorite: existingRoot ? (existingRoot.is_favorite || false) : false,
      manual_category: existingRoot ? (existingRoot.manual_category || null) : null,
    };

    if (existingRoot && rootStrategy) {
      // Keep old meaning and origin, merge derivatives
      updatedRoot.meaning = existingRoot.meaning;
      updatedRoot.deep_origin = existingRoot.deep_origin;
      const combined = [...new Set([...(existingRoot.derivatives || []), ...(part.derivatives || [])])];
      updatedRoot.derivatives = combined;
    }

    await safeSetItem(rootKey, JSON.stringify(updatedRoot));
    
    // Save parts into savedParts to return in formatted data
    savedParts.push({
      segment: updatedRoot.segment,
      type: updatedRoot.type,
      meaning: updatedRoot.meaning,
      deep_origin: updatedRoot.deep_origin,
      derivatives: updatedRoot.derivatives
    });
  }

  // 7. Format Word Data for Storage
  const finalEngine = 'remote'; // Saved as remote source
  const finalKey = `${finalEngine}_${contextMode}`;

  const updatedWord: WordData = {
    word: parsedData.word || finalWord,
    display_breakdown: parsedData.display_breakdown || parsedData.word || finalWord,
    phonetic_us: parsedData.phonetic_us || '',
    primary_meaning: parsedData.primary_meaning || '',
    noun_source: parsedData.noun_source || '',
    parts: savedParts,
    memory_lines: parsedData.memory_lines || [],
    memory_lines_map: existingWord ? (existingWord.memory_lines_map || {}) : {},
    edited_keys: existingWord ? (existingWord.edited_keys || []) : [],
    lookup_count: existingWord ? (existingWord.lookup_count || 0) + 1 : 1,
    updated_at: Date.now(),
    learning_status: existingWord ? (existingWord.learning_status || null) : null,
    favorite_folder_ids: existingWord ? (existingWord.favorite_folder_ids || []) : [],
    is_favorite: existingWord ? (existingWord.is_favorite || false) : false,
  };

  if (!updatedWord.memory_lines_map) {
    updatedWord.memory_lines_map = {};
  }

  if (!(updatedWord.edited_keys || []).includes(finalKey)) {
    updatedWord.memory_lines_map[finalKey] = parsedData.memory_lines || [];
  }

  // Set the current viewable memory lines
  updatedWord.memory_lines = updatedWord.memory_lines_map[finalKey];
  updatedWord.sourceTag = 'api';

  // 8. Write to storage
  await safeSetItem(wordStorageKey, JSON.stringify(updatedWord));

  return updatedWord;
};

export const getUnifiedWordTreeData = async (
  wordOrRoot: string
): Promise<WordTreeData | null> => {
  const clean = wordOrRoot.trim().toLowerCase();
  if (!clean) return null;

  let rootEntry: any = null;
  let rootSegment = '';

  // 1. Try finding cached root info in AsyncStorage
  const cleanSegName = clean.replace(/^-|-$/g, '');
  const cachedRootStr = await AsyncStorage.getItem('R:' + cleanSegName);
  if (cachedRootStr) {
    rootEntry = JSON.parse(cachedRootStr);
    rootSegment = rootEntry.segment || clean;
  }

  // 2. If not found, try finding cached word info to discover its root segment parts
  if (!rootEntry) {
    const cachedWordStr = await AsyncStorage.getItem('W:' + clean);
    if (cachedWordStr) {
      const wordEntry = JSON.parse(cachedWordStr);
      if (wordEntry && wordEntry.parts && wordEntry.parts.length > 0) {
        const firstRootPart = wordEntry.parts.find((p: any) => p.type === '词根') || wordEntry.parts[0];
        if (firstRootPart && firstRootPart.segment) {
          rootSegment = firstRootPart.segment.trim().toLowerCase();
          const cleanSubSeg = rootSegment.replace(/^-|-$/g, '');
          const cachedSubRootStr = await AsyncStorage.getItem('R:' + cleanSubSeg);
          if (cachedSubRootStr) {
            rootEntry = JSON.parse(cachedSubRootStr);
          } else {
            rootEntry = firstRootPart;
          }
        }
      }
    }
  }

  // 3. Fallback to offline static dictionary tree data
  if (!rootEntry) {
    const offlineTree = await getWordTreeData(clean);
    if (offlineTree) {
      // Resolve potential custom meanings for derivatives in the static tree
      const derivativesWithCustomMeaning = await Promise.all(
        offlineTree.derivatives.map(async (d) => {
          const cachedD = await AsyncStorage.getItem('W:' + d.word.toLowerCase());
          if (cachedD) {
            const parsedD = JSON.parse(cachedD);
            return {
              word: d.word,
              meaning: parsedD.primary_meaning || parsedD.meaning || d.meaning,
            };
          }
          return d;
        })
      );
      return {
        root: offlineTree.root,
        derivatives: derivativesWithCustomMeaning,
      };
    }
    return null;
  }

  // 4. If rootEntry exists, construct dynamic tree structure using derivatives list
  const derivativeList = rootEntry.derivatives || [];
  const derivatives: Array<{ word: string; meaning: string }> = [];

  const uniqueDerivatives = [...new Set(derivativeList)] as string[];
  for (const d of uniqueDerivatives) {
    const dWord = d.trim().toLowerCase();
    
    // Check AsyncStorage first
    const cachedWord = await AsyncStorage.getItem('W:' + dWord);
    let meaning = '';
    if (cachedWord) {
      const parsedWord = JSON.parse(cachedWord);
      meaning = parsedWord.primary_meaning || parsedWord.meaning || '';
    }
    
    // Fallback to offline query
    if (!meaning) {
      const offlineWord = await queryOfflineWord(dWord);
      if (offlineWord) {
        meaning = offlineWord.primary_meaning || '';
      }
    }

    derivatives.push({
      word: d,
      meaning: meaning || '暂无释义',
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
