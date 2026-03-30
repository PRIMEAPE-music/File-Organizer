import type { WordPreviewData } from '../../../shared/types'

interface Props {
  data: WordPreviewData
}

export default function WordPreview({ data }: Props) {
  if (!data.html) {
    return <p className="text-sm text-zinc-400 italic">No content in this document</p>
  }

  return (
    <div
      className="word-preview text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: data.html }}
    />
  )
}
