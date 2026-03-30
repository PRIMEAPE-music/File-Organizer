import type { Editor } from '@tiptap/react'
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, CodeSquare
} from 'lucide-react'

interface Props {
  editor: Editor | null
}

export default function NoteToolbar({ editor }: Props) {
  if (!editor) return null

  const btn = (
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    title: string
  ) => (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
      }`}
      title={title}
    >
      {icon}
    </button>
  )

  const addLink = () => {
    const url = window.prompt('Enter URL:')
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 flex-wrap">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold className="w-4 h-4" />, 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic className="w-4 h-4" />, 'Italic')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough className="w-4 h-4" />, 'Strikethrough')}
      {btn(editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <Code className="w-4 h-4" />, 'Code')}

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600 mx-1" />

      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 className="w-4 h-4" />, 'Heading 1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="w-4 h-4" />, 'Heading 2')}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="w-4 h-4" />, 'Heading 3')}

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600 mx-1" />

      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List className="w-4 h-4" />, 'Bullet List')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="w-4 h-4" />, 'Ordered List')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote className="w-4 h-4" />, 'Blockquote')}

      <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-600 mx-1" />

      {btn(editor.isActive('link'), addLink, <Link2 className="w-4 h-4" />, 'Link')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), <CodeSquare className="w-4 h-4" />, 'Code Block')}
    </div>
  )
}
