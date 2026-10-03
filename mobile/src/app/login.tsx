import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorNote, Input, T } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setInfo(null);
    if (!email.includes('@') || password.length < 6) {
      setError('اكتب إيميل صحيح وكلمة مرور 6 أحرف على الأقل');
      return;
    }
    setLoading(true);
    const creds = { email: email.trim(), password };
    const { data, error: err } =
      mode === 'signin' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setLoading(false);
    if (err) setError(err.message);
    else if (mode === 'signup' && !data.session) setInfo('تم إنشاء الحساب. افتح إيميلك وأكّد التسجيل ثم سجّل دخول.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <View style={{ gap: 12 }}>
          <T bold size={30}>مشاريعي</T>
          <T muted>مشاريعك وأفكارك في مكان واحد، مع أجينت ذكي يتابعها معك.</T>
          <View style={{ height: 12 }} />
          <ErrorNote message={error} />
          {info ? <T style={{ color: colors.success }}>{info}</T> : null}
          <Input placeholder="الإيميل" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Input placeholder="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
          <Button title={mode === 'signin' ? 'دخول' : 'إنشاء حساب'} onPress={submit} loading={loading} />
          <Button
            variant="secondary"
            title={mode === 'signin' ? 'ما عندي حساب — سجّل جديد' : 'عندي حساب — دخول'}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
