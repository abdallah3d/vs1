import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let currentToken: string | null = null;

export type PushStatus = 'registered' | 'denied' | 'simulator' | 'no-project-id' | 'error';

/**
 * Asks for notification permission, gets this device's Expo push token and
 * saves it so the server can notify this phone. Safe to call on every launch.
 */
export async function registerForPush(): Promise<PushStatus> {
  try {
    // Also remember the user's time zone so the morning brief arrives at their local hour.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await supabase.from('user_settings').upsert({ time_zone: timeZone }, { onConflict: 'user_id' });

    if (!Device.isDevice) return 'simulator';

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'التنبيهات',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('No EAS projectId: run `npx eas-cli@latest init` in mobile/ to enable push notifications.');
      return 'no-project-id';
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    currentToken = token;
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ token, platform: Platform.OS, last_seen_at: new Date().toISOString() }, { onConflict: 'token' });
    if (error) throw new Error(error.message);
    return 'registered';
  } catch (e) {
    console.warn('push registration failed', e);
    return 'error';
  }
}

/** Stops notifications to this phone for the signed-out account. */
export async function unregisterPush() {
  if (currentToken) await supabase.from('push_tokens').delete().eq('token', currentToken);
  currentToken = null;
}
