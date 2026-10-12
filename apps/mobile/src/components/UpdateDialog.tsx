import React from 'react'
import {
  Modal,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import type { UpdateInfo } from '../updater/github-updater'

interface UpdateDialogProps {
  visible: boolean
  updateInfo: UpdateInfo | null
  isDownloading: boolean
  downloadProgress: number
  onDismiss: () => void
  onUpdate: () => void
}

export function UpdateDialog({
  visible,
  updateInfo,
  isDownloading,
  downloadProgress,
  onDismiss,
  onUpdate,
}: UpdateDialogProps) {
  const theme = useTheme()

  if (!visible || !updateInfo) return null

  const progressPercent = Math.round(downloadProgress * 100)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <View style={styles.header}>
            <Text style={[type.title, { color: theme.text }]}>Update Available 🚀</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 4 }]}>
              {updateInfo.currentVersion} → {updateInfo.latestVersion}
            </Text>
          </View>

          <View style={[styles.notesContainer, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator={true}>
              <Text style={[type.bodyStrong, { color: theme.protein, marginBottom: space.xs }]}>
                {updateInfo.releaseTitle}
              </Text>
              <Text style={[type.caption, { color: theme.text, lineHeight: 20 }]}>
                {updateInfo.releaseNotes}
              </Text>
            </ScrollView>
          </View>

          <Text style={[type.caption, { color: theme.carbs, marginBottom: space.md, textAlign: 'center' }]}>
            🛡️ All your meal logs, weight history, and settings are preserved.
          </Text>

          {isDownloading ? (
            <View style={styles.progressSection}>
              <View style={[styles.progressBarBackground, { backgroundColor: theme.border }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      backgroundColor: theme.protein,
                      width: `${progressPercent}%`,
                    },
                  ]}
                />
              </View>
              <View style={styles.progressLabelRow}>
                <ActivityIndicator size="small" color={theme.protein} />
                <Text style={[type.caption, { color: theme.text, marginLeft: space.xs }]}>
                  Downloading update… {progressPercent}%
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.dismissButton, { borderColor: theme.border }]}
                onPress={onDismiss}
                activeOpacity={0.7}
              >
                <Text style={[type.body, { color: theme.textMuted }]}>Later</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.updateButton, { backgroundColor: theme.protein }]}
                onPress={onUpdate}
                activeOpacity={0.8}
              >
                <Text style={[type.bodyStrong, { color: '#0B0B0F' }]}>Update Now</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
  },
  header: {
    marginBottom: space.md,
  },
  notesContainer: {
    borderWidth: 1,
    borderRadius: radius.lg,
    maxHeight: 180,
    padding: space.md,
    marginBottom: space.md,
  },
  notesScroll: {
    flexGrow: 0,
  },
  progressSection: {
    marginVertical: space.sm,
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: space.sm,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButton: {
    borderWidth: 1,
  },
  updateButton: {
    flex: 1,
  },
})
