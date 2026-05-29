import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
  FlatList,
  SafeAreaView,
  StatusBar,
  Alert,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Picker } from '@react-native-picker/picker';
import Tts from 'react-native-tts';
import { PanResponder } from 'react-native';

import { LightTheme, DarkTheme } from '../utils/theme';
import { safeSetItem } from '../utils/storage';

const LIBRARY_KEY = '@word_library';
const ROOT_LIBRARY_KEY = '@root_library';
const FOLDERS_KEY = '@fav_folders';

const DEFAULT_FOLDERS = [
  { id: 'fav_default', name: '⭐ 默认收藏夹' }
];

interface Flashcard {
  id: string;
  type: 'word' | 'root';
  title: string;
  meaning: string;
  phonetic?: string;
  display_breakdown?: string;
  noun_source?: string;
  parts?: any[];
  memory_lines?: string[];
  learning_status?: string | null;
  favorite_folder_ids?: string[];
}

const FavoritesScreen = () => {
  const systemScheme = useColorScheme();
  const [uiTheme, setUiTheme] = useState('system');
  const activeTheme = uiTheme === 'system' ? (systemScheme || 'light') : uiTheme;
  const theme = activeTheme === 'dark' ? DarkTheme : LightTheme;
  const styles = getStyles(theme);

  // Tabs: 'study' (卡片特训) or 'manager' (分组管理)
  const [activeTab, setActiveTab] = useState('study');

  // Favorites data state
  const [folders, setFolders] = useState<any[]>(DEFAULT_FOLDERS);
  const [starredWords, setStarredWords] = useState<any[]>([]);
  const [starredRoots, setStarredRoots] = useState<any[]>([]);

  // Flashcards Study states
  const [selectedFolderId, setSelectedFolderId] = useState('all_words');
  const [studyMode, setStudyMode] = useState('both'); // both, word_only, root_only
  const [isShuffle, setIsShuffle] = useState(true); // all_words, all_roots, or folderId
  const [selectedStatus, setSelectedStatus] = useState('all'); // all, learned, review
  const [deck, setDeck] = useState<Flashcard[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [scoreRemembered, setScoreRemembered] = useState(0);
  const [scoreForgotten, setScoreForgotten] = useState(0);
  const [studyCompleted, setStudyCompleted] = useState(false);
  const [isStudying, setIsStudying] = useState(false);

  // Folder management states
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);

  // Load all favorites data
  const loadFavoritesData = async () => {
    try {
      // 1. Folders
      const fStr = await AsyncStorage.getItem(FOLDERS_KEY);
      if (fStr) {
        setFolders(JSON.parse(fStr));
      } else {
        setFolders(DEFAULT_FOLDERS);
      }

      // 2. Starred Words
      const wordsStr = await AsyncStorage.getItem(LIBRARY_KEY);
      if (wordsStr) {
        setStarredWords(JSON.parse(wordsStr));
      } else {
        setStarredWords([]);
      }

      // 3. Starred Roots
      const rootsStr = await AsyncStorage.getItem(ROOT_LIBRARY_KEY);
      if (rootsStr) {
        setStarredRoots(JSON.parse(rootsStr));
      } else {
        setStarredRoots([]);
      }

      // 4. UI Theme
      const themeVal = await AsyncStorage.getItem('ui_theme');
      if (themeVal) {
        setUiTheme(themeVal);
      }
    } catch (e) {
      console.error('Failed to load favorites database', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFavoritesData();
    }, [])
  );

  // Audio Pronunciation TTS
  const playSound = async (text: string) => {
    try {
      Tts.stop();
      await Tts.setDefaultLanguage('en-US');
      Tts.speak(text);
    } catch (e) {
      console.log('TTS Error', e);
    }
  };

  // Build Study Deck
  const handleStartStudy = () => {
    let rawCards: Flashcard[] = [];

    // 1. Merge words
    if (studyMode !== 'root_only' && (selectedFolderId === 'all_words' || selectedFolderId !== 'all_roots')) {
      const matchedWords = starredWords.filter((w) => {
        // Folder check
        if (selectedFolderId !== 'all_words') {
          const itemFolders = w.favorite_folder_ids || (w.favorite_folder_id ? [w.favorite_folder_id] : []) || [];
          if (!itemFolders.includes(selectedFolderId)) return false;
        }
        // Status filter
        if (selectedStatus === 'learned' && w.learning_status !== 'learned') return false;
        if (selectedStatus === 'review' && w.learning_status !== 'review') return false;
        return true;
      }).map((w) => ({
        id: 'W:' + w.word.toLowerCase(),
        type: 'word' as const,
        title: w.word,
        meaning: w.primary_meaning || w.meaning || '',
        phonetic: w.phonetic_us || '',
        display_breakdown: w.display_breakdown || '',
        noun_source: w.noun_source || '',
        parts: w.parts || [],
        memory_lines: w.memory_lines || [],
        learning_status: w.learning_status || null,
        favorite_folder_ids: w.favorite_folder_ids || [],
      }));
      rawCards = [...rawCards, ...matchedWords];
    }

    // 2. Merge roots
    if (studyMode !== 'word_only' && (selectedFolderId === 'all_roots' || selectedFolderId !== 'all_words')) {
      const matchedRoots = starredRoots.filter((r) => {
        // Folder check
        if (selectedFolderId !== 'all_roots') {
          const itemFolders = r.favorite_folder_ids || (r.favorite_folder_id ? [r.favorite_folder_id] : []) || [];
          if (!itemFolders.includes(selectedFolderId)) return false;
        }
        // Status filter
        if (selectedStatus === 'learned' && r.learning_status !== 'learned') return false;
        if (selectedStatus === 'review' && r.learning_status !== 'review') return false;
        return true;
      }).map((r) => ({
        id: 'R:' + r.segment.toLowerCase().replace(/^-|-$/g, ''),
        type: 'root' as const,
        title: r.segment,
        meaning: r.meaning || '',
        phonetic: '',
        display_breakdown: '',
        noun_source: '',
        parts: [],
        memory_lines: r.derivatives ? [`同根派生词: ${r.derivatives.join(', ')}`] : [],
        learning_status: r.learning_status || null,
        favorite_folder_ids: r.favorite_folder_ids || [],
      }));
      rawCards = [...rawCards, ...matchedRoots];
    }

    if (rawCards.length === 0) {
      Alert.alert('提示', '当前选定的分类中没有符合过滤条件的特训内容！');
      return;
    }

    // Shuffle the deck
    if (isShuffle) { rawCards.sort(() => Math.random() - 0.5); }

    setDeck(rawCards);
    setCurrentCardIndex(0);
    setFlipped(false);
    setScoreRemembered(0);
    setScoreForgotten(0);
    setStudyCompleted(false);
    setIsStudying(true);
  };

  // Update card learning status in AsyncStorage
  const updateCardStatus = async (card: Flashcard, status: 'learned' | 'review') => {
    try {
      const storageKey = card.type === 'word' ? 'W:' + card.title.toLowerCase() : 'R:' + card.title.toLowerCase().replace(/^-|-$/g, '');
      const cachedStr = await AsyncStorage.getItem(storageKey);
      if (cachedStr) {
        const itemObj = JSON.parse(cachedStr);
        itemObj.learning_status = status;
        await safeSetItem(storageKey, JSON.stringify(itemObj));
      }

      if (card.type === 'word') {
        const updated = starredWords.map((w) => {
          if (w.word.toLowerCase() === card.title.toLowerCase()) {
            return { ...w, learning_status: status };
          }
          return w;
        });
        setStarredWords(updated);
        await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));
      } else {
        const updated = starredRoots.map((r) => {
          if (r.segment.toLowerCase().replace(/^-|-$/g, '') === card.title.toLowerCase().replace(/^-|-$/g, '')) {
            return { ...r, learning_status: status };
          }
          return r;
        });
        setStarredRoots(updated);
        await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(updated));
      }
    } catch (e) {
      console.error('Failed to sync learning status update', e);
    }
  };

    // Pan Responder for swiping cards
  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > 20; // Only trigger if swiped left/right
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (!isStudying || studyCompleted) return;
      if (gestureState.dx > 50) {
        // Swiped Right -> Remembered
        handleRemember();
      } else if (gestureState.dx < -50) {
        // Swiped Left -> Forgot
        handleForget();
      }
    }
  }), [isStudying, studyCompleted, currentCardIndex, flipped]); // Need to make sure handlers get latest state? Wait, we can use refs or handleRemember without deps if they use setScore(prev) and setCurrentCardIndex(prev).
  
  // Let's refactor handleRemember / handleForgot to use functional state updates if not already, or we can just attach panResponder to the View.
  // User remembered the card
  const handleRemember = async () => {
    const currentCard = deck[currentCardIndex];
    setScoreRemembered((prev) => prev + 1);
    await updateCardStatus(currentCard, 'learned');
    moveToNextCard();
  };

  // User forgot the card
  const handleForget = async () => {
    const currentCard = deck[currentCardIndex];
    setScoreForgotten((prev) => prev + 1);
    await updateCardStatus(currentCard, 'review');
    moveToNextCard();
  };

  const moveToNextCard = () => {
    if (currentCardIndex + 1 < deck.length) {
      setFlipped(false);
      setCurrentCardIndex((prev) => prev + 1);
    } else {
      setStudyCompleted(true);
    }
  };

  // Create Folder
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    
    // Check duplicates
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('提示', '分组名称已存在，请换一个名字！');
      return;
    }

    const newFolder = {
      id: 'fav_' + Date.now(),
      name: name,
    };

    const updated = [...folders, newFolder];
    setFolders(updated);
    await safeSetItem(FOLDERS_KEY, JSON.stringify(updated));
    setNewFolderName('');
    Alert.alert('成功', '新建分组成功！');
  };

  // Delete Folder
  const handleDeleteFolder = (folderId: string, folderName: string) => {
    if (folderId === 'fav_default') {
      Alert.alert('提示', '默认收藏夹不可删除！');
      return;
    }

    Alert.alert('警告', `确定要删除分组「${folderName}」吗？（组内的单词只会被清空分类，不会在数据库中被删除）`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确定删除',
        style: 'destructive',
        onPress: async () => {
          const updatedFolders = folders.filter((f) => f.id !== folderId);
          setFolders(updatedFolders);
          await safeSetItem(FOLDERS_KEY, JSON.stringify(updatedFolders));

          // Clean up words references
          const updatedWords = starredWords.map((w) => {
            const itemFolders = w.favorite_folder_ids || [];
            if (itemFolders.includes(folderId)) {
              return { ...w, favorite_folder_ids: itemFolders.filter((id: string) => id !== folderId) };
            }
            return w;
          });
          setStarredWords(updatedWords);
          await safeSetItem(LIBRARY_KEY, JSON.stringify(updatedWords));

          // Clean up roots references
          const updatedRoots = starredRoots.map((r) => {
            const itemFolders = r.favorite_folder_ids || [];
            if (itemFolders.includes(folderId)) {
              return { ...r, favorite_folder_ids: itemFolders.filter((id: string) => id !== folderId) };
            }
            return r;
          });
          setStarredRoots(updatedRoots);
          await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(updatedRoots));

          if (selectedFolderId === folderId) {
            setSelectedFolderId('all_words');
          }
          Alert.alert('已删除', '分组已成功移除');
        },
      },
    ]);
  };

  // Start edit folder name
  const startEditFolder = (folderId: string, currentName: string) => {
    if (folderId === 'fav_default') return;
    setEditingFolderId(folderId);
    setEditFolderName(currentName);
  };

  // Save edited folder name
  const saveFolderEdit = async () => {
    const trimmed = editFolderName.trim();
    if (!trimmed || !editingFolderId) {
      setEditingFolderId(null);
      return;
    }

    const updated = folders.map((f) => {
      if (f.id === editingFolderId) {
        return { ...f, name: trimmed };
      }
      return f;
    });

    setFolders(updated);
    await safeSetItem(FOLDERS_KEY, JSON.stringify(updated));
    setEditingFolderId(null);
  };

  // Remove single item from folder or unfavorite it entirely
  const handleRemoveItemFromFavorites = async (item: any, type: 'word' | 'root') => {
    Alert.alert('取消收藏', `确定要将「${type === 'word' ? item.word : item.segment}」移出特训库吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          if (type === 'word') {
            const cleanWord = item.word.toLowerCase();
            const updated = starredWords.filter((w) => w.word.toLowerCase() !== cleanWord);
            setStarredWords(updated);
            await safeSetItem(LIBRARY_KEY, JSON.stringify(updated));

            // Sync original W: key state
            const storageKey = 'W:' + cleanWord;
            const stored = await AsyncStorage.getItem(storageKey);
            if (stored) {
              const obj = JSON.parse(stored);
              obj.is_favorite = false;
              obj.favorite_folder_ids = [];
              await safeSetItem(storageKey, JSON.stringify(obj));
            }
          } else {
            const cleanSeg = item.segment.toLowerCase().replace(/^-|-$/g, '');
            const updated = starredRoots.filter((r) => r.segment.toLowerCase().replace(/^-|-$/g, '') !== cleanSeg);
            setStarredRoots(updated);
            await safeSetItem(ROOT_LIBRARY_KEY, JSON.stringify(updated));

            // Sync original R: key state
            const storageKey = 'R:' + cleanSeg;
            const stored = await AsyncStorage.getItem(storageKey);
            if (stored) {
              const obj = JSON.parse(stored);
              obj.is_favorite = false;
              obj.favorite_folder_ids = [];
              await safeSetItem(storageKey, JSON.stringify(obj));
            }
          }
        },
      },
    ]);
  };

  // Count items inside a folder
  const getFolderItemCounts = (folderId: string) => {
    let wordCount = 0;
    let rootCount = 0;

    if (folderId === 'all_words') return { words: starredWords.length, roots: 0 };
    if (folderId === 'all_roots') return { words: 0, roots: starredRoots.length };

    starredWords.forEach((w) => {
      const folderList = w.favorite_folder_ids || (w.favorite_folder_id ? [w.favorite_folder_id] : []) || [];
      if (folderList.includes(folderId)) wordCount++;
    });

    starredRoots.forEach((r) => {
      const folderList = r.favorite_folder_ids || (r.favorite_folder_id ? [r.favorite_folder_id] : []) || [];
      if (folderList.includes(folderId)) rootCount++;
    });

    return { words: wordCount, roots: rootCount };
  };

  const currentCard = deck[currentCardIndex] || null;
  const progressPercent = deck.length > 0 ? (currentCardIndex / deck.length) * 100 : 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBar} backgroundColor={theme.cardBg} />

      {/* Main Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'study' && styles.activeTabButton]}
          onPress={() => { setActiveTab('study'); setIsStudying(false); }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'study' && styles.activeTabButtonText]}>🃏 卡片特训</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'folders' && styles.activeTabButton]}
          onPress={() => { setActiveTab('folders'); setExpandedFolderId(null); }}
        >
          <Text style={[styles.tabButtonText, activeTab === 'folders' && styles.activeTabButtonText]}>📋 分组管理</Text>
        </TouchableOpacity>
      </View>

      {/* ---------------- 🃏 TAB 1: CARD STUDY ---------------- */}
      {activeTab === 'study' && (
        <View style={styles.tabBody}>
          {!isStudying ? (
            /* Configure Study Deck */
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={styles.setupCard}>
                <Text style={styles.setupTitle}>✨ 特训卡片卡组配置</Text>
                
                <Text style={styles.setupLabel}>选择待复习的分组 (Favorites Folder)</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedFolderId}
                    style={{ color: theme.text }}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => setSelectedFolderId(val)}
                  >
                    <Picker.Item label="📚 所有收藏单词 (All Words)" value="all_words" />
                    <Picker.Item label="🌱 所有收藏词根 (All Roots)" value="all_roots" />
                    {folders.map((f) => (
                      <Picker.Item key={f.id} label={`${f.name}`} value={f.id} />
                    ))}
                  </Picker>
                </View>

                <Text style={styles.setupLabel}>过滤学习标记 (Recall Status)</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedStatus}
                    style={{ color: theme.text }}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => setSelectedStatus(val)}
                  >
                    <Picker.Item label="🏷️ 所有标记 (全部)" value="all" />
                    <Picker.Item label="✅ 仅已学完 (Learned)" value="learned" />
                    <Picker.Item label="🔄 仅待复习 (Review)" value="review" />
                  </Picker>
                </View>

                                <Text style={styles.setupLabel}>过滤模式 (单词/词根分离)</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={studyMode}
                    style={{ color: theme.text }}
                    dropdownIconColor={theme.primary}
                    onValueChange={(val) => setStudyMode(val)}
                  >
                    <Picker.Item label="📚🌱 单词和词根全学 (Both)" value="both" />
                    <Picker.Item label="📚 仅学单词 (Words Only)" value="word_only" />
                    <Picker.Item label="🌱 仅学词根 (Roots Only)" value="root_only" />
                  </Picker>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }}>
                  <Text style={[styles.setupLabel, { marginBottom: 0 }]}>🔀 打乱随机顺序 (Shuffle)</Text>
                  <Switch value={isShuffle} onValueChange={setIsShuffle} />
                </View>

                {/* Dashboard Stats */}
                <View style={styles.quickStatsRow}>
                  <View style={styles.quickStatBox}>
                    <Text style={styles.quickStatNum}>{starredWords.length}</Text>
                    <Text style={styles.quickStatLabel}>收藏单词</Text>
                  </View>
                  <View style={[styles.quickStatBox, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.border }]}>
                    <Text style={styles.quickStatNum}>{starredRoots.length}</Text>
                    <Text style={styles.quickStatLabel}>收藏词根</Text>
                  </View>
                  <View style={styles.quickStatBox}>
                    <Text style={styles.quickStatNum}>
                      {starredWords.filter((w) => w.learning_status === 'review').length + 
                       starredRoots.filter((r) => r.learning_status === 'review').length}
                    </Text>
                    <Text style={styles.quickStatLabel}>待复习</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.startBtn} onPress={handleStartStudy}>
                  <Text style={styles.startBtnText}>⚡ 开启卡片特训记忆</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : studyCompleted ? (
            /* Study Complete View */
            <View style={styles.completeCard}>
              <Icon name="checkmark-circle-sharp" size={72} color={theme.success} />
              <Text style={styles.completeTitle}>🎉 特训完成！</Text>
              <Text style={styles.completeSub}>已完成本次卡组中的所有单词或词根复习。</Text>

              <View style={styles.scoreBoard}>
                <View style={styles.scoreBox}>
                  <Text style={[styles.scoreNum, { color: theme.success }]}>{scoreRemembered}</Text>
                  <Text style={styles.scoreLabel}>记得 ✅</Text>
                </View>
                <View style={styles.scoreBox}>
                  <Text style={[styles.scoreNum, { color: theme.danger }]}>{scoreForgotten}</Text>
                  <Text style={styles.scoreLabel}>忘记 ❌</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.actionBtnBlock} onPress={() => setIsStudying(false)}>
                <Text style={styles.actionBtnBlockText}>返回配置其他分类</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtnBlock, { backgroundColor: theme.primary, marginTop: 12 }]} onPress={handleStartStudy}>
                <Text style={styles.actionBtnBlockText}>再试一次本组 🔄</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Interactive Flashcard View */
            <View style={{ flex: 1 }}>
              {/* Top Progress bar */}
              <View style={styles.progressRow}>
                <Text style={styles.progressText}>进度：{currentCardIndex + 1} / {deck.length}</Text>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                </View>
              </View>

              {/* Central Active recall Card */}
              <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.card, flipped && styles.cardFlipped]}
                onPress={() => setFlipped(!flipped)}
                {...panResponder.panHandlers}
              >
                {!flipped ? (
                  /* FRONT of the card */
                  <View style={styles.cardContent}>
                    <View style={styles.cardBadge}>
                      <Text style={styles.cardBadgeText}>{currentCard.type === 'word' ? '📖 单词' : '🌱 词根'}</Text>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={2}>{currentCard.title}</Text>
                    
                    {currentCard.phonetic ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                        <Text style={styles.cardPhonetic}>/{currentCard.phonetic}/</Text>
                        <TouchableOpacity style={styles.audioBtn} onPress={() => playSound(currentCard.title)}>
                          <Icon name="volume-high" size={20} color={theme.primary} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={[styles.audioBtn, { marginTop: 10 }]} onPress={() => playSound(currentCard.title.replace(/^-|-$/g, ''))}>
                        <Icon name="volume-high" size={22} color={theme.primary} />
                      </TouchableOpacity>
                    )}

                    <Text style={styles.tapToFlipHint}>👆 点击翻转显示解析</Text>
                  </View>
                ) : (
                  /* BACK of the card */
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.cardBackContent} showsVerticalScrollIndicator={false}>
                    <Text style={styles.cardBackTitle}>{currentCard.title}</Text>
                    
                    <Text style={styles.cardMeaningHeader}>💡 释义：</Text>
                    <Text style={styles.cardBackMeaning}>{currentCard.meaning}</Text>

                    {currentCard.noun_source ? (
                      <Text style={styles.cardNounSource}>🎯 名词源追溯：{currentCard.noun_source}</Text>
                    ) : null}

                    {currentCard.parts && currentCard.parts.length > 0 && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={styles.cardMeaningHeader}>🧩 词根拆解：</Text>
                        {currentCard.parts.map((p: any, idx: number) => (
                          <Text key={idx} style={styles.cardPartText}>
                            • <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>{p.segment}</Text> ({p.type}): {p.meaning}
                          </Text>
                        ))}
                      </View>
                    )}

                    {currentCard.memory_lines && currentCard.memory_lines.length > 0 && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={styles.cardMeaningHeader}>🧠 记忆联想：</Text>
                        {currentCard.memory_lines.map((l: string, idx: number) => (
                          <Text key={idx} style={styles.cardMemoryLineText}>💡 {l}</Text>
                        ))}
                      </View>
                    )}

                    <Text style={styles.tapToFlipBackHint}>👆 点击卡片翻回正面</Text>
                  </ScrollView>
                )}
              </TouchableOpacity>

              {/* Bottom active feedback action buttons */}
              <View style={styles.feedbackRow}>
                <TouchableOpacity style={[styles.feedbackBtn, styles.forgotBtn]} onPress={handleForget}>
                  <Icon name="close-circle" size={20} color="#fff" />
                  <Text style={styles.feedbackBtnText}>忘记 ❌</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.feedbackBtn, styles.rememberBtn]} onPress={handleRemember}>
                  <Icon name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.feedbackBtnText}>记得 ✅</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.exitBtn} onPress={() => setIsStudying(false)}>
                <Text style={styles.exitBtnText}>退出特训</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ---------------- 📋 TAB 2: FOLDER MANAGEMENT ---------------- */}
      {activeTab === 'folders' && (
        <View style={styles.tabBody}>
          
          {/* Create Folder Header */}
          <View style={styles.createFolderRow}>
            <TextInput
              style={styles.folderInput}
              placeholder="新增自定义分组名称..."
              placeholderTextColor={theme.textMuted}
              value={newFolderName}
              onChangeText={setNewFolderName}
            />
            <TouchableOpacity style={styles.folderCreateBtn} onPress={handleCreateFolder}>
              <Text style={styles.folderCreateBtnText}>新建</Text>
            </TouchableOpacity>
          </View>

          {/* List of folders */}
          <FlatList
            data={folders}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const counts = getFolderItemCounts(item.id);
              const isExpanded = expandedFolderId === item.id;
              const isEditing = editingFolderId === item.id;

              // Filter words and roots in expanded folder
              const folderWords = starredWords.filter((w) => {
                const flist = w.favorite_folder_ids || (w.favorite_folder_id ? [w.favorite_folder_id] : []) || [];
                return flist.includes(item.id);
              });
              const folderRoots = starredRoots.filter((r) => {
                const flist = r.favorite_folder_ids || (r.favorite_folder_id ? [r.favorite_folder_id] : []) || [];
                return flist.includes(item.id);
              });

              return (
                <View style={styles.folderCard}>
                  <View style={styles.folderHeaderRow}>
                    <TouchableOpacity 
                      style={{ flex: 1 }}
                      onPress={() => setExpandedFolderId(isExpanded ? null : item.id)}
                    >
                      {isEditing ? (
                        <TextInput
                          style={styles.inlineEditInput}
                          value={editFolderName}
                          onChangeText={setEditFolderName}
                          autoFocus
                          onSubmitEditing={saveFolderEdit}
                          onBlur={saveFolderEdit}
                        />
                      ) : (
                        <View>
                          <Text style={styles.folderNameText}>{item.name}</Text>
                          <Text style={styles.folderSubCounts}>包含单词 {counts.words} 个 | 词根 {counts.roots} 个</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    <View style={styles.folderActions}>
                      {item.id !== 'fav_default' && (
                        <>
                          <TouchableOpacity onPress={() => isEditing ? saveFolderEdit() : startEditFolder(item.id, item.name)} style={styles.folderIconBtn}>
                            <Icon name={isEditing ? "checkmark" : "create-outline"} size={20} color={theme.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteFolder(item.id, item.name)} style={styles.folderIconBtn}>
                            <Icon name="trash-outline" size={20} color={theme.danger} />
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity onPress={() => setExpandedFolderId(isExpanded ? null : item.id)}>
                        <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Expanded Content: list items inside folder */}
                  {isExpanded && (
                    <View style={styles.expandedItemsContainer}>
                      <Text style={styles.expandedSectionTitle}>📖 收藏单词：</Text>
                      {folderWords.map((w, idx) => (
                        <View key={idx} style={styles.starredItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemTitleText}>{w.word} {w.learning_status === 'learned' && <Text style={{ color: theme.success, fontSize: 10 }}>[已学完]</Text>}</Text>
                            <Text style={styles.itemMeaningText} numberOfLines={1}>{w.primary_meaning || w.meaning}</Text>
                          </View>
                          <TouchableOpacity onPress={() => handleRemoveItemFromFavorites(w, 'word')}>
                            <Icon name="star" size={20} color="#f59e0b" />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {folderWords.length === 0 && <Text style={styles.emptyTextMini}>本组暂无收藏单词</Text>}

                      <Text style={[styles.expandedSectionTitle, { marginTop: 12 }]}>🌱 收藏词根：</Text>
                      {folderRoots.map((r, idx) => (
                        <View key={idx} style={styles.starredItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemTitleText}>{r.segment} {r.learning_status === 'learned' && <Text style={{ color: theme.success, fontSize: 10 }}>[已学完]</Text>}</Text>
                            <Text style={styles.itemMeaningText} numberOfLines={1}>{r.meaning}</Text>
                          </View>
                          <TouchableOpacity onPress={() => handleRemoveItemFromFavorites(r, 'root')}>
                            <Icon name="star" size={20} color="#f59e0b" />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {folderRoots.length === 0 && <Text style={styles.emptyTextMini}>本组暂无收藏词根</Text>}
                    </View>
                  )}
                </View>
              );
            }}
          />
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
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  activeTabButton: {
    borderBottomWidth: 3,
    borderBottomColor: theme.primary,
  },
  tabButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.tabInactive,
  },
  activeTabButtonText: {
    color: theme.primary,
  },
  tabBody: {
    flex: 1,
    padding: 16,
  },

  // Setup Flashcards View
  setupCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOpacity: theme.shadowOpacity,
    elevation: 2,
    marginTop: 10,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  setupLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 8,
    marginTop: 12,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 10,
    backgroundColor: theme.inputBg,
    marginBottom: 16,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  quickStatsRow: {
    flexDirection: 'row',
    marginVertical: 20,
    backgroundColor: theme.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 12,
  },
  quickStatBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickStatNum: {
    fontSize: 18,
    fontWeight: '900',
    color: theme.primaryText,
  },
  quickStatLabel: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 2,
  },
  startBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    marginTop: 12,
  },
  startBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Active Studying View
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.textMuted,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: theme.border,
    borderRadius: 4,
    marginLeft: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.success,
  },
  card: {
    flex: 1,
    backgroundColor: theme.cardBg,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: theme.border,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'stretch',
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: theme.shadowOpacity,
    shadowRadius: 12,
    elevation: 4,
    minHeight: 380,
  },
  cardFlipped: {
    borderColor: theme.primary,
  },
  cardContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  cardBackContent: {
    flex: 1,
  },
  cardBadge: {
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  cardBadgeText: {
    fontSize: 12,
    color: theme.primaryText,
    fontWeight: 'bold',
  },
  cardTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: theme.text,
    textAlign: 'center',
  },
  cardPhonetic: {
    fontSize: 18,
    color: theme.textMuted,
    marginRight: 8,
  },
  audioBtn: {
    padding: 6,
    backgroundColor: theme.volumeBg,
    borderRadius: 16,
  },
  tapToFlipHint: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 40,
    fontStyle: 'italic',
  },
  tapToFlipBackHint: {
    fontSize: 12,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 24,
    fontStyle: 'italic',
    paddingBottom: 10,
  },
  cardBackTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.primary,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingBottom: 10,
    marginBottom: 15,
  },
  cardMeaningHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.textMuted,
    marginTop: 8,
  },
  cardBackMeaning: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
    lineHeight: 24,
    marginTop: 4,
  },
  cardNounSource: {
    fontSize: 13,
    color: theme.primaryText,
    backgroundColor: theme.primaryLight,
    padding: 8,
    borderRadius: 6,
    marginTop: 10,
    overflow: 'hidden',
  },
  cardPartText: {
    fontSize: 14,
    color: theme.text,
    lineHeight: 20,
    marginTop: 4,
  },
  cardMemoryLineText: {
    fontSize: 13,
    color: theme.text,
    lineHeight: 20,
    marginTop: 4,
    fontStyle: 'italic',
  },

  feedbackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 20,
  },
  feedbackBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    gap: 8,
  },
  forgotBtn: {
    backgroundColor: theme.danger,
  },
  rememberBtn: {
    backgroundColor: theme.success,
  },
  feedbackBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  exitBtn: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  exitBtnText: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: 'bold',
  },

  // Completion Screen
  completeCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOpacity: theme.shadowOpacity,
    elevation: 2,
    marginTop: 20,
  },
  completeTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.text,
    marginTop: 16,
  },
  completeSub: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  scoreBoard: {
    flexDirection: 'row',
    gap: 30,
    marginVertical: 24,
  },
  scoreBox: {
    alignItems: 'center',
  },
  scoreNum: {
    fontSize: 28,
    fontWeight: '900',
  },
  scoreLabel: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 4,
  },
  actionBtnBlock: {
    width: '100%',
    backgroundColor: theme.border,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnBlockText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: 'bold',
  },

  // Tab 2: Folder Manager Styles
  createFolderRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  folderInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: theme.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: theme.inputBg,
    fontSize: 15,
    color: theme.text,
  },
  folderCreateBtn: {
    backgroundColor: theme.primary,
    paddingHorizontal: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  folderCreateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  folderCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
  },
  folderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  folderNameText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
  },
  folderSubCounts: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 4,
  },
  folderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  folderIconBtn: {
    padding: 4,
  },
  inlineEditInput: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.text,
    borderBottomWidth: 1,
    borderBottomColor: theme.primary,
    paddingVertical: 2,
    width: '100%',
  },
  expandedItemsContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 12,
  },
  expandedSectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 8,
  },
  starredItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  itemTitleText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.text,
  },
  itemMeaningText: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 2,
  },
  emptyTextMini: {
    fontSize: 11,
    color: theme.textMuted,
    fontStyle: 'italic',
    marginLeft: 6,
    marginBottom: 6,
  },
});

export default FavoritesScreen;
