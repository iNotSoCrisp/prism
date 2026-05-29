import { app } from 'electron'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type Provider = 'openai' | 'anthropic' | 'gemini'
export type Role = 'user' | 'assistant' | 'system'

export interface Chat {
  id: string
  title: string
  provider: Provider
  model: string
  created_at: number
  updated_at: number
}

export interface Message {
  id: string
  chat_id: string
  role: Role
  content: string
  created_at: number
}

let db: Database.Database | null = null

function databasePath(): string {
  const filePath = join(app.getPath('userData'), 'prism.db')
  mkdirSync(dirname(filePath), { recursive: true })
  return filePath
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(databasePath())
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db)
  }

  return db
}

export function createTables(database = getDb()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL DEFAULT 'gpt-4o',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function getAllChats(): Chat[] {
  return getDb().prepare('SELECT * FROM chats ORDER BY updated_at DESC').all() as Chat[]
}

export function getChat(id: string): Chat | null {
  return (getDb().prepare('SELECT * FROM chats WHERE id = ?').get(id) as Chat | undefined) ?? null
}

export function createChat(provider: Provider = 'openai', model = 'gpt-4o'): Chat {
  const now = Date.now()
  const chat: Chat = {
    id: randomUUID(),
    title: 'New Chat',
    provider,
    model,
    created_at: now,
    updated_at: now
  }

  getDb()
    .prepare(
      'INSERT INTO chats (id, title, provider, model, created_at, updated_at) VALUES (@id, @title, @provider, @model, @created_at, @updated_at)'
    )
    .run(chat)

  return chat
}

export function deleteChat(id: string): void {
  getDb().prepare('DELETE FROM chats WHERE id = ?').run(id)
}

export function updateChatTitle(id: string, title: string): Chat | null {
  const cleanTitle = title.trim() || 'New Chat'
  const now = Date.now()
  getDb().prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(cleanTitle, now, id)
  return getChat(id)
}

export function updateChatMeta(id: string, provider: Provider, model: string): Chat | null {
  const now = Date.now()
  getDb().prepare('UPDATE chats SET provider = ?, model = ?, updated_at = ? WHERE id = ?').run(provider, model, now, id)
  return getChat(id)
}

export function touchChat(id: string): void {
  getDb().prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function getMessages(chatId: string): Message[] {
  return getDb().prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId) as Message[]
}

export function createMessage(input: { chatId: string; role: Role; content: string }): Message {
  const message: Message = {
    id: randomUUID(),
    chat_id: input.chatId,
    role: input.role,
    content: input.content,
    created_at: Date.now()
  }

  const insertMessage = getDb().transaction(() => {
    getDb()
      .prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (@id, @chat_id, @role, @content, @created_at)')
      .run(message)
    touchChat(input.chatId)
  })

  insertMessage()
  return message
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

export const getSettings = getSetting
export const setSettings = setSetting

export function closeDb(): void {
  db?.close()
  db = null
}
