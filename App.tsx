import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import AudioExtractor from './modules/audio-extractor/src/AudioExtractorModule';
import { colors } from './theme';
import { AppText, TextSettingsProvider, useTextSettings, type TextSize, type TextWeightSetting } from './TextSettingsContext';
import { CheckCircleIcon, HeadphoneIcon, UploadIcon } from './icons';
import { YOUTUBE_EXTRACT_FUNCTION_URL } from './config';

type Status = 'idle' | 'extracting' | 'done' | 'error';

// The native module needs a plain filesystem path, not a file:// URI.
function toFsPath(uri: string) {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;

function parseContentDispositionFilename(header: string | null): string | null {
  const match = header?.match(/filename="?([^";]+)"?/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'normal', label: '보통' },
  { value: 'large', label: '크게' },
  { value: 'xlarge', label: '아주 크게' },
];

const WEIGHT_OPTIONS: { value: TextWeightSetting; label: string }[] = [
  { value: 'normal', label: '보통' },
  { value: 'bold', label: '굵게' },
];

function TextSettingsBar() {
  const { size, weight, setSize, setWeight } = useTextSettings();

  return (
    <View style={styles.settingsBar}>
      <View style={styles.settingsGroup}>
        <AppText style={styles.settingsLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          글자 크기
        </AppText>
        <View style={styles.segmentedRow}>
          {SIZE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.segment, size === option.value && styles.segmentActive]}
              onPress={() => setSize(option.value)}
            >
              <AppText
                style={[styles.segmentLabel, size === option.value && styles.segmentLabelActive]}
                weight={size === option.value ? 'semibold' : 'normal'}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.settingsGroup}>
        <AppText style={styles.settingsLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          굵기
        </AppText>
        <View style={styles.segmentedRow}>
          {WEIGHT_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.segment, styles.segmentWide, weight === option.value && styles.segmentActive]}
              onPress={() => setWeight(option.value)}
            >
              <AppText
                style={[styles.segmentLabel, weight === option.value && styles.segmentLabelActive]}
                weight={weight === option.value ? 'semibold' : 'normal'}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {option.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function AudioExtractorScreen() {
  const { size } = useTextSettings();
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceUri, setSourceUri] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  const [saveName, setSaveName] = useState('');
  const [outputFile, setOutputFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const saveNameInputRef = useRef<TextInput>(null);

  const scrollSaveNameIntoView = () => {
    // Wait a tick so the keyboard has started animating in before we measure.
    requestAnimationFrame(() => {
      const scrollNode = scrollRef.current;
      const inputNode = saveNameInputRef.current;
      if (!scrollNode || !inputNode) return;
      // ScrollView is a valid measureLayout target at runtime (it forwards to the
      // underlying native view), but its TS type predates the New Architecture
      // HostInstance typing, so a cast is needed here.
      inputNode.measureLayout(
        scrollNode as unknown as Parameters<typeof inputNode.measureLayout>[0],
        (_left, top) => {
          scrollNode.scrollTo({ y: Math.max(top - 80, 0), animated: true });
        },
        () => scrollNode.scrollToEnd({ animated: true })
      );
    });
  };

  const pickVideo = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const baseName = asset.name.replace(/\.[^/.]+$/, '');
    setSourceName(asset.name);
    setSourceUri(asset.uri);
    setLinkInput('');
    setSaveName(baseName);
    setOutputFile(null);
    setStatus('idle');
    setMessage(null);
  };

  // The physical file/MediaStore entry always uses an ASCII, timestamp-based
  // name — Korean, spaces, and other special characters in a file:// URI have
  // caused FileNotFoundException on some devices. The Korean/free-form name the
  // user types is display-only (shown in the result card and the save alert)
  // and never touches a filesystem or MediaStore path.
  const extractAudio = async () => {
    if (!sourceUri) return;

    const cacheDir = Paths.cache;
    if (!cacheDir.exists) {
      cacheDir.create({ intermediates: true, idempotent: true });
    }

    const output = new File(cacheDir, `extracted_${Date.now()}.m4a`);

    setStatus('extracting');
    setMessage(null);

    const inputPath = toFsPath(sourceUri);
    const outputPath = toFsPath(output.uri);

    try {
      await AudioExtractor.extractAudio(inputPath, outputPath);
      if (!output.exists) {
        throw new Error('추출된 파일을 찾을 수 없습니다.');
      }
      setOutputFile(output);
      setStatus('done');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const extractFromLink = async () => {
    const trimmedLink = linkInput.trim();
    if (!trimmedLink) return;

    if (!YOUTUBE_URL_PATTERN.test(trimmedLink)) {
      setStatus('error');
      setMessage('올바른 유튜브 링크를 입력해주세요.');
      return;
    }

    const cacheDir = Paths.cache;
    if (!cacheDir.exists) {
      cacheDir.create({ intermediates: true, idempotent: true });
    }

    setSourceUri(null);
    setSourceName(null);
    setOutputFile(null);
    setStatus('extracting');
    setMessage(null);

    try {
      const requestUrl = `${YOUTUBE_EXTRACT_FUNCTION_URL}?url=${encodeURIComponent(trimmedLink)}`;
      const response = await fetch(requestUrl);

      if (!response.ok) {
        // The function returns a JSON { error: "사람이 읽을 메시지" } body on
        // failure — downloadFileAsync would only expose the HTTP status code,
        // so we fetch manually to surface that message instead.
        let friendlyMessage = '서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.';
        try {
          const errorBody = await response.json();
          if (typeof errorBody?.error === 'string') friendlyMessage = errorBody.error;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        throw new Error(friendlyMessage);
      }

      const arrayBuffer = await response.arrayBuffer();
      const filename =
        parseContentDispositionFilename(response.headers.get('Content-Disposition')) ??
        `youtube_${Date.now()}.mp3`;
      const file = new File(cacheDir, filename);
      file.write(new Uint8Array(arrayBuffer));

      const baseName = file.name.replace(/\.[^/.]+$/, '');
      setOutputFile(file);
      setSourceName(file.name);
      setSaveName(baseName);
      setStatus('done');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const displayName = saveName.trim() || sourceName || '오디오';

  const saveToLibrary = async () => {
    if (!outputFile) return;

    const permission = await requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한 필요', '미디어 라이브러리 저장 권한이 필요합니다.');
      return;
    }

    try {
      const asset = await Asset.create(outputFile.uri);
      const savedUri = await asset.getUri();
      const savedFile = new File(savedUri);
      if (!savedFile.exists) {
        throw new Error('저장된 파일을 찾을 수 없습니다.');
      }
      Alert.alert('저장 완료', `${displayName} 파일이 라이브러리에 저장되었습니다.`);
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : String(error));
    }
  };

  const inputFontSize = size === 'xlarge' ? 16 : size === 'large' ? 15 : 14;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextSettingsBar />

          <View style={styles.header}>
            <HeadphoneIcon size={44} color={colors.accentIcon} />
            <AppText style={styles.title} weight="bold" numberOfLines={2}>
              오디오 추출기
            </AppText>
          </View>

          <View style={styles.card}>
            <Pressable style={styles.pickerArea} onPress={pickVideo}>
              <UploadIcon size={30} color={colors.accentIcon} />
              <AppText
                style={styles.pickerLabel}
                weight="semibold"
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {sourceUri ? sourceName : '동영상 선택'}
              </AppText>
              {!sourceUri && (
                <AppText style={styles.pickerHint} numberOfLines={2}>
                  탭하여 동영상 파일을 선택하세요
                </AppText>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <AppText style={styles.dividerLabel}>또는</AppText>
              <View style={styles.dividerLine} />
            </View>

            <TextInput
              style={[styles.input, { fontSize: inputFontSize }]}
              value={linkInput}
              onChangeText={setLinkInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="유튜브 링크 붙여넣기"
              placeholderTextColor={colors.placeholder}
            />

            <Pressable
              style={[styles.secondaryButton, (!linkInput.trim() || status === 'extracting') && styles.buttonDisabled]}
              onPress={extractFromLink}
              disabled={!linkInput.trim() || status === 'extracting'}
            >
              <AppText style={styles.secondaryButtonText} weight="semibold">
                링크에서 오디오 추출
              </AppText>
            </Pressable>

            {sourceName && (
              <TextInput
                ref={saveNameInputRef}
                style={[styles.input, { fontSize: inputFontSize }]}
                value={saveName}
                onChangeText={setSaveName}
                onFocus={scrollSaveNameIntoView}
                onBlur={() => setSaveName((prev) => prev.trim())}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="저장할 파일 이름"
                placeholderTextColor={colors.placeholder}
              />
            )}

            {sourceUri && (
              <Pressable
                style={[styles.primaryButton, status === 'extracting' && styles.buttonDisabled]}
                onPress={extractAudio}
                disabled={status === 'extracting'}
              >
                <AppText style={styles.primaryButtonText} weight="semibold">
                  오디오 추출
                </AppText>
              </Pressable>
            )}

            {status === 'extracting' && (
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.accent} />
                <AppText style={styles.statusText}>추출 중...</AppText>
              </View>
            )}

            {status === 'error' && message && (
              <AppText style={styles.errorText}>{message}</AppText>
            )}

            {status === 'done' && outputFile && (
              <View style={styles.resultBlock}>
                <CheckCircleIcon size={36} color={colors.success} />
                <AppText
                  style={[styles.statusText, styles.successText]}
                  weight="semibold"
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {displayName}
                </AppText>
                <Pressable style={styles.primaryButton} onPress={saveToLibrary}>
                  <AppText style={styles.primaryButtonText} weight="semibold">
                    라이브러리에 저장
                  </AppText>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <TextSettingsProvider>
      <AudioExtractorScreen />
    </TextSettingsProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 20,
  },
  settingsBar: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
  },
  settingsGroup: {
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  settingsLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  segmentedRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  segment: {
    minHeight: 28,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    justifyContent: 'center',
  },
  segmentWide: {
    paddingHorizontal: 16,
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  segmentLabelActive: {
    color: '#FFFFFF',
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    color: colors.text,
  },
  card: {
    width: '100%',
    minHeight: 200,
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 24,
    gap: 16,
    shadowColor: '#B99C8C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 4,
  },
  pickerArea: {
    minHeight: 120,
    borderWidth: 2,
    borderColor: colors.accentIcon,
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pickerLabel: {
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
  },
  pickerHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  secondaryButton: {
    minHeight: 48,
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.accentIcon,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.accentIcon,
    fontSize: 15,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: colors.text,
  },
  primaryButton: {
    minHeight: 52,
    width: '100%',
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    color: colors.text,
  },
  successText: {
    color: colors.success,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
  resultBlock: {
    alignItems: 'center',
    gap: 12,
  },
});
