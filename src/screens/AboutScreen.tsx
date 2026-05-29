import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { LightTheme, DarkTheme } from '../utils/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineWordsListCache, offlineRootsListCache, loadOfflineListCacheIntoMemory } from '../utils/offlineDict';

const { width } = Dimensions.get('window');

const AboutScreen = ({ navigation }: any) => {
  const [uiTheme, setUiTheme] = useState('system');
  const [stats, setStats] = useState({ words: 0, roots: 0 });

  useEffect(() => {
    const loadThemeAndStats = async () => {
      try {
        const val = await AsyncStorage.getItem('ui_theme');
        if (val) setUiTheme(val);

        await loadOfflineListCacheIntoMemory();
        setStats({
          words: offlineWordsListCache.length,
          roots: offlineRootsListCache.length,
        });
      } catch (e) {
        console.error('Failed to load theme/stats in AboutScreen', e);
      }
    };
    loadThemeAndStats();
  }, []);

  const theme = uiTheme === 'dark' ? DarkTheme : LightTheme;
  const styles = getStyles(theme);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App介绍与使用指南</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Banner Section */}
        <View style={styles.bannerContainer}>
          <View style={styles.bannerIconWrapper}>
            <Icon name="cube-outline" size={60} color="#fff" />
          </View>
          <Text style={styles.appName}>AI Word Tracker</Text>
          <Text style={styles.appDesc}>你的下一代智能词根记忆图谱引擎</Text>
        </View>

        {/* Stats Section */}
        <View style={styles.statsCard}>
          <Text style={styles.sectionTitle}>📊 离线词库统计</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{stats.words}</Text>
              <Text style={styles.statLabel}>单词总量</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{stats.roots}</Text>
              <Text style={styles.statLabel}>词根/词缀</Text>
            </View>
          </View>
        </View>

        {/* Guide Section */}
        
        {/* Full App Documentation Section */}
        <View style={styles.guideCard}>
          <Text style={styles.sectionTitle}>📖 完整产品手册 (App Manual)</Text>
          
          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Icon name="hardware-chip-outline" size={24} color="#38bdf8" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>一、AI 引擎与查词机制</Text>
              <Text style={styles.guideDesc}>AiWord 的核心在于【混合架构】。我们在本地集成了海量词库（可通过设置页进行数据导入更新），确保毫秒级极速响应。当您查询的单词或词根在本地库中缺失时，App会自动呼叫绑定的 LLM (如 DeepSeek, OpenAI) 进行即时生成，并将生成的词源、词根树、联想记忆图同步展示给您。</Text>
            </View>
          </View>

          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Icon name="color-palette-outline" size={24} color="#f59e0b" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>二、情景模式 (Contexts)</Text>
              <Text style={styles.guideDesc}>你可以通过设置页，无限量配置自定义的“情景模式”。比如创建一个【考研英语】情景，并编写专属 Prompt 要求 AI 在解析时强调考研真题考法；或者创建【极客开发】情景，让 AI 解释该词在计算机科学中的术语。查询历史会根据情景进行独立记录过滤。</Text>
            </View>
          </View>
          
          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Icon name="git-network-outline" size={24} color="#10b981" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>三、无限派生记忆树</Text>
              <Text style={styles.guideDesc}>我们在词库、词根库和查词结果中都嵌入了强大的【🌳 派生树】功能。这是一种基于图谱逻辑的树状结构，它可以把一个主词根下的所有衍生词、同源词通过层级关系展示出来，帮助你顺藤摸瓜，一次性成体系地记住几十个相关词汇。</Text>
            </View>
          </View>

          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
              <Icon name="albums-outline" size={24} color="#8b5cf6" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>四、特训收藏夹体系</Text>
              <Text style={styles.guideDesc}>遇到想背的词或词根，点击【★ 收藏】，即可将它们按组别收入囊中。在“收藏夹”标签页里，我们内置了类似 Tinder 的“沉浸式左右划卡”背单词模式，并且支持 TTS（文字转语音）发音、乱序特训和纯粹的词根模式/单词模式过滤，助你高效内化知识。</Text>
            </View>
          </View>
          
          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Icon name="cloud-offline-outline" size={24} color="#ef4444" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>五、隐私与离线优先</Text>
              <Text style={styles.guideDesc}>AiWord 的本地词库、所有历史记录、情景预设和查词缓存均保存在你的本地设备存储中。即使你不配置任何 API 甚至完全断网，依然可以像查字典一样畅快使用离线词库功能，不用担心任何隐私泄露。</Text>
            </View>
          </View>
          
          <View style={styles.guideItem}>
            <View style={[styles.guideIcon, { backgroundColor: 'rgba(100, 116, 139, 0.15)' }]}>
              <Icon name="document-text-outline" size={24} color="#64748b" />
            </View>
            <View style={styles.guideTextContainer}>
              <Text style={styles.guideTitle}>六、高阶数据配置 (JSON)</Text>
              <Text style={styles.guideDesc}>在设置页中，高级玩家可以自定义全局的 JSON 约束模板，精准调控 AI 返回的数据结构。并且我们支持极速导入本地合规的词库 JSON 或 Bin 格式文件，无限扩充你的弹药库。</Text>
            </View>
          </View>
        </View>


        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 15,
    backgroundColor: theme.cardBg,
    elevation: 4,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: theme.shadowOpacity,
    shadowRadius: 6,
  },
  backBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: theme.background,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  bannerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: theme.primary,
    overflow: 'hidden',
  },
  bannerIconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
  appDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 8,
  },
  statsCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: theme.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: theme.textMuted,
    fontWeight: '500',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: theme.border,
  },
  guideCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  guideItem: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  guideIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  guideTextContainer: {
    flex: 1,
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 6,
  },
  guideDesc: {
    fontSize: 14,
    color: theme.textMuted,
    lineHeight: 22,
  },
});

export default AboutScreen;
