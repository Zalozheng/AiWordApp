import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

export const safeSetItem = async (key: string, value: string): Promise<boolean> => {
  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    console.error('AsyncStorage Write Error: ', e);
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('full') || msg.includes('quota') || msg.includes('space') || msg.includes('database is locked')) {
      Alert.alert(
        '⚠️ 储存空间极低或数据库锁死',
        '手机剩余储存空间极低，或者数据库发生并发写冲突，导致数据无法保存。请立即清理手机空间或重启App重试！',
        [{ text: '我知道了' }]
      );
    } else {
      Alert.alert('⚠️ 保存失败', '无法保存数据，请检查设备空间后重试。');
    }
    return false;
  }
};

export const safeGetItem = async (key: string): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.error('AsyncStorage Read Error: ', e);
    return null;
  }
};

export const safeRemoveItem = async (key: string): Promise<boolean> => {
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch (e) {
    console.error('AsyncStorage Remove Error: ', e);
    return false;
  }
};

export const safeMultiRemove = async (keys: string[]): Promise<boolean> => {
  try {
    await (AsyncStorage as any).multiRemove(keys);
    return true;
  } catch (e) {
    console.error('AsyncStorage multiRemove Error: ', e);
    return false;
  }
};
