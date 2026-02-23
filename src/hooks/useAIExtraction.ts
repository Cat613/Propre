import { useState } from 'react'
import { extractLyricsFromImage } from '../services/aiService'

interface UseAIExtractionProps {
    geminiApiKey: string | null
    onRequireApiKey: () => void
    onSuccess: (text: string) => void
}

export const useAIExtraction = ({ geminiApiKey, onRequireApiKey, onSuccess }: UseAIExtractionProps) => {
    const [isAILoading, setIsAILoading] = useState(false)

    const handleAIExtract = async () => {
        if (!geminiApiKey) {
            onRequireApiKey()
            return
        }

        try {
            const filePaths = await window.ipcRenderer.selectMediaFiles()
            if (filePaths.length === 0) return

            const filePath = filePaths[0]
            const extension = filePath.split('.').pop()?.toLowerCase() || ''
            const validExtensions = ['jpg', 'jpeg', 'png', 'webp']

            if (!validExtensions.includes(extension)) {
                alert('이미지 파일(JPG, PNG, WEBP)만 선택 가능합니다.')
                return
            }

            setIsAILoading(true)

            // Assuming file:// protocol works in fetch for Electron renderer
            const response = await fetch(`file://${filePath}`)
            const blob = await response.blob()
            const mimeType = blob.type

            // Convert to Base64 manually
            const reader = new FileReader()
            reader.onloadend = async () => {
                const base64data = reader.result?.toString().split(',')[1] // remove data:image... block
                if (!base64data) {
                    setIsAILoading(false)
                    alert('이미지를 읽는데 실패했습니다.')
                    return
                }

                const result = await extractLyricsFromImage(geminiApiKey, base64data, mimeType)
                setIsAILoading(false)

                if (result.success && result.text) {
                    onSuccess(result.text)
                } else {
                    alert('가사 추출 실패: ' + (result.error || '알 수 없는 오류'))
                }
            }
            reader.readAsDataURL(blob)

        } catch (error) {
            console.error('AI Extraction failed:', error)
            alert('가사 추출 중 오류가 발생했습니다.')
            setIsAILoading(false)
        }
    }

    return { isAILoading, handleAIExtract }
}
