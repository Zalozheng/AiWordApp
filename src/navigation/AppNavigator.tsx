import React from 'react';
import { useColorScheme } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { LightTheme, DarkTheme } from '../utils/theme';
import { loadOfflineListCacheIntoMemory, checkAndOptimizeOfflineDict, loadOfflinePreviewsIntoMemory } from '../utils/offlineDict';

const Tab = createBottomTabNavigator();

const AppNavigator = () => {
  const systemScheme = useColorScheme();
  const [uiTheme, setUiTheme] = React.useState('system');

  const loadTheme = async () => {
    try {
      const val = await AsyncStorage.getItem('ui_theme');
      if (val) {
        setUiTheme(val);
      }
    } catch (e) {
      console.error('Failed to load theme in AppNavigator', e);
    }
  };

  React.useEffect(() => {
    loadTheme();
    // Run optimizations in background
    setTimeout(() => {
      checkAndOptimizeOfflineDict()
        .then(() => {
          return loadOfflinePreviewsIntoMemory();
        })
        .then(() => {
          return loadOfflineListCacheIntoMemory();
        })
        .catch((err) => {
          console.warn('Pre-loading offline dictionary failed:', err);
        });
    }, 100);
  }, []);

  const activeTheme = uiTheme === 'system' ? (systemScheme || 'light') : uiTheme;
  const theme = activeTheme === 'dark' ? DarkTheme : LightTheme;

  // React Navigation Theme configurations to override white background canvas
  const navTheme = {
    ...DefaultTheme,
    dark: activeTheme === 'dark',
    colors: {
      ...DefaultTheme.colors,
      primary: theme.primary,
      background: theme.background,
      card: theme.cardBg,
      text: theme.text,
      border: theme.border,
      notification: theme.accent,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme} onStateChange={loadTheme}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;

              if (route.name === 'Home') {
                iconName = focused ? 'search' : 'search-outline';
              } else if (route.name === 'Library') {
                iconName = focused ? 'book' : 'book-outline';
              } else if (route.name === 'Favorites') {
                iconName = focused ? 'star' : 'star-outline';
              } else if (route.name === 'Settings') {
                iconName = focused ? 'settings' : 'settings-outline';
              }

              return <Icon name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.tabInactive,
            tabBarStyle: {
              backgroundColor: theme.cardBg,
              borderTopColor: theme.border,
              height: 60,
              paddingBottom: 8,
              paddingTop: 8,
            },
            headerShown: false, // Screens handle their own headers
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: '查词' }} />
          <Tab.Screen name="Library" component={LibraryScreen} options={{ title: '词库' }} />
          <Tab.Screen name="Favorites" component={FavoritesScreen} options={{ title: '收藏夹' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

export default AppNavigator;

