import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { Platform } from 'react-native'

export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GitHubReleaseResponse {
  tag_name: string
  name: string | null
  body: string | null
  published_at?: string
  assets: GitHubReleaseAsset[]
}

export interface UpdateInfo {
  isUpdateAvailable: boolean
  latestVersion: string
  currentVersion: string
  releaseTitle: string
  releaseNotes: string
  downloadUrl: string
  fileName: string
}

export const CURRENT_APP_VERSION = '1.4.1'
export const REPO_OWNER = 'Sarty-085'
export const REPO_NAME = 'nut-ai-gateway'
const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/**
 * Compares two semantic version strings (e.g., '1.4.1' vs '1.4.0').
 * Returns true if latest > current.
 */
export function isVersionNewer(latest: string, current: string): boolean {
  const cleanLatest = latest.replace(/^v/i, '').split('-')[0].split('+')[0]
  const cleanCurrent = current.replace(/^v/i, '').split('-')[0].split('+')[0]

  const lParts = cleanLatest.split('.').map((p) => parseInt(p, 10) || 0)
  const cParts = cleanCurrent.split('.').map((p) => parseInt(p, 10) || 0)

  const maxLen = Math.max(lParts.length, cParts.length)
  for (let i = 0; i < maxLen; i++) {
    const l = lParts[i] ?? 0
    const c = cParts[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

/**
 * Checks GitHub Releases for the latest APK build.
 */
export async function checkForAppUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'WorkFitAI-Mobile-App',
      },
    })

    if (!response.ok) {
      return null
    }

    const data: GitHubReleaseResponse = await response.json()
    if (!data.assets || !Array.isArray(data.assets)) {
      return null
    }

    // Find the APK file among release assets
    const apkAsset = data.assets.find((asset) => asset.name.toLowerCase().endsWith('.apk'))
    if (!apkAsset) {
      return null
    }

    const latestVersion = data.tag_name.replace(/^v/i, '').trim()
    const updateAvailable = isVersionNewer(latestVersion, CURRENT_APP_VERSION)

    return {
      isUpdateAvailable: updateAvailable,
      latestVersion: data.tag_name,
      currentVersion: `v${CURRENT_APP_VERSION}`,
      releaseTitle: data.name || `Release ${data.tag_name}`,
      releaseNotes: data.body || 'New features and improvements for WorkFit AI.',
      downloadUrl: apkAsset.browser_download_url,
      fileName: apkAsset.name,
    }
  } catch (error) {
    console.warn('[GitHubUpdater] Failed to check for updates:', error)
    return null
  }
}

/**
 * Downloads the APK with progress callback and triggers native installation.
 */
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<{ success: boolean; error?: string }> {
  if (Platform.OS !== 'android') {
    return { success: false, error: 'In-app updates are only supported on Android devices.' }
  }

  try {
    const targetDir = `${FileSystem.cacheDirectory}updates/`
    const dirInfo = await FileSystem.getInfoAsync(targetDir)
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true })
    }

    const targetFile = `${targetDir}${fileName}`
    const existingFile = await FileSystem.getInfoAsync(targetFile)
    if (existingFile.exists) {
      await FileSystem.deleteAsync(targetFile, { idempotent: true })
    }

    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      targetFile,
      {},
      (downloadProgress) => {
        if (downloadProgress.totalBytesExpectedToWrite > 0 && onProgress) {
          const progress =
            downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
          onProgress(Math.min(1, Math.max(0, progress)))
        }
      },
    )

    const downloadResult = await downloadResumable.downloadAsync()
    if (!downloadResult || !downloadResult.uri) {
      return { success: false, error: 'Download failed to complete.' }
    }

    // Convert file:// to Android content:// URI via FileProvider
    const contentUri = await FileSystem.getContentUriAsync(downloadResult.uri)

    // Trigger Android package installer intent
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    })

    return { success: true }
  } catch (error: any) {
    console.error('[GitHubUpdater] Download/install error:', error)
    return { success: false, error: error?.message || 'Failed to install update.' }
  }
}
