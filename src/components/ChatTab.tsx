import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';

interface ChatMessage {
  messageId: bigint;
  channelType: string;
  channelKey: string;
  authorUsername: string;
  body: string;
  createdAt: { microsSinceUnixEpoch: bigint };
}

type TabId = 'global' | 'party' | 'guild' | `whisper:${string}`;

const DEFAULT_TABS: TabId[] = ['global', 'party', 'guild'];

interface ChatTabProps {
  username: string;
}

function storageKey(username: string): string {
  return `chat_open_tabs_${username}`;
}

export default function ChatTab({ username }: ChatTabProps) {
  const [globalMessages] = useTable(tables.myGlobalChat);
  const [partyMessages] = useTable(tables.myPartyChat);
  const [whispers] = useTable(tables.myWhispers);
  const send = useReducer(reducers.sendChatMessage);

  const [openTabs, setOpenTabs] = useState<TabId[]>(DEFAULT_TABS);
  const [activeTab, setActiveTab] = useState<TabId>('global');
  const [unreadTabs, setUnreadTabs] = useState<Set<TabId>>(new Set());
  const [input, setInput] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey(username))
      .then(raw => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every(t => typeof t === 'string')) {
              setOpenTabs(parsed as TabId[]);
            }
          } catch {
            /* ignore malformed */
          }
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(storageKey(username), JSON.stringify(openTabs)).catch(
      () => {}
    );
  }, [openTabs, username, hydrated]);

  const markUnread = (id: TabId) => {
    setUnreadTabs(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Auto-open a whisper tab + mark unread only for messages that arrive AFTER
  // mount, so a user-closed whisper stays closed until the other side says
  // something new and first-load history doesn't spam unread dots.
  const seenWhisperIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenWhisperIds.current === null) {
      seenWhisperIds.current = new Set(
        whispers.map(w => w.messageId.toString())
      );
      return;
    }
    for (const msg of whispers) {
      const id = msg.messageId.toString();
      if (seenWhisperIds.current.has(id)) continue;
      seenWhisperIds.current.add(id);
      const [a, b] = msg.channelKey.split(':');
      const partner = a === username ? b : a;
      if (!partner) continue;
      const tabId: TabId = `whisper:${partner}`;
      setOpenTabs(prev => (prev.includes(tabId) ? prev : [...prev, tabId]));
      if (msg.authorUsername !== username && activeTab !== tabId) {
        markUnread(tabId);
      }
    }
  }, [whispers, username, activeTab]);

  const seenGlobalIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenGlobalIds.current === null) {
      seenGlobalIds.current = new Set(
        globalMessages.map(m => m.messageId.toString())
      );
      return;
    }
    for (const msg of globalMessages) {
      const id = msg.messageId.toString();
      if (seenGlobalIds.current.has(id)) continue;
      seenGlobalIds.current.add(id);
      if (msg.authorUsername === username) continue;
      if (activeTab === 'global') continue;
      markUnread('global');
    }
  }, [globalMessages, activeTab, username]);

  const seenPartyIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenPartyIds.current === null) {
      seenPartyIds.current = new Set(
        partyMessages.map(m => m.messageId.toString())
      );
      return;
    }
    for (const msg of partyMessages) {
      const id = msg.messageId.toString();
      if (seenPartyIds.current.has(id)) continue;
      seenPartyIds.current.add(id);
      if (msg.authorUsername === username) continue;
      if (activeTab === 'party') continue;
      markUnread('party');
    }
  }, [partyMessages, activeTab, username]);

  // Clear unread when the user focuses a tab.
  useEffect(() => {
    setUnreadTabs(prev => {
      if (!prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.delete(activeTab);
      return next;
    });
  }, [activeTab]);

  const messagesForTab = (tab: TabId): ChatMessage[] => {
    if (tab === 'global') return [...globalMessages] as ChatMessage[];
    if (tab === 'party') return [...partyMessages] as ChatMessage[];
    if (tab === 'guild') return [];
    const partner = tab.slice('whisper:'.length);
    return (whispers as readonly ChatMessage[]).filter(msg => {
      const [a, b] = msg.channelKey.split(':');
      return a === partner || b === partner;
    });
  };

  const activeMessages = useMemo(
    () =>
      [...messagesForTab(activeTab)].sort((a, b) =>
        a.createdAt.microsSinceUnixEpoch <
        b.createdAt.microsSinceUnixEpoch
          ? 1
          : -1
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, globalMessages, partyMessages, whispers]
  );

  const ensureTab = (id: TabId) => {
    setOpenTabs(prev => (prev.includes(id) ? prev : [...prev, id]));
  };

  const closeTab = (id: TabId) => {
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== id);
      if (activeTab === id) {
        setActiveTab(next[0] ?? 'global');
      }
      return next;
    });
  };

  const onSubmit = async () => {
    const text = input.trim();
    if (!text) return;

    // Slash commands.
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/).filter(Boolean);
      const cmd = parts[0]?.toLowerCase() ?? '';
      if (cmd === 'global' || cmd === 'g') {
        ensureTab('global');
        setActiveTab('global');
        setInput('');
        return;
      }
      if (cmd === 'party' || cmd === 'p') {
        ensureTab('party');
        setActiveTab('party');
        setInput('');
        return;
      }
      if (cmd === 'guild') {
        ensureTab('guild');
        setActiveTab('guild');
        setInput('');
        return;
      }
      if (cmd === 'w' || cmd === 'whisper') {
        const target = parts[1]?.trim().toLowerCase();
        if (!target) {
          setInput('');
          return;
        }
        const rest = parts.slice(2).join(' ').trim();
        const tabId = `whisper:${target}` as TabId;
        ensureTab(tabId);
        setActiveTab(tabId);
        setInput('');
        if (rest) {
          send({
            channelType: 'whisper',
            targetUsername: target,
            body: rest,
          }).catch(() => {});
        }
        return;
      }
      // Unknown slash command: clear and drop silently.
      setInput('');
      return;
    }

    if (activeTab === 'guild') return;

    if (activeTab.startsWith('whisper:')) {
      const target = activeTab.slice('whisper:'.length);
      send({ channelType: 'whisper', targetUsername: target, body: text }).catch(
        () => {}
      );
    } else if (activeTab === 'party') {
      send({ channelType: 'party', targetUsername: '', body: text }).catch(
        () => {}
      );
    } else {
      send({ channelType: 'global', targetUsername: '', body: text }).catch(
        () => {}
      );
    }
    setInput('');
  };

  const isGuild = activeTab === 'guild';
  const activeIsWhisper = activeTab.startsWith('whisper:');
  const activePartner = activeIsWhisper
    ? activeTab.slice('whisper:'.length)
    : null;

  return (
    <View className="flex-1 bg-slate-950">
      <View className="bg-slate-900 border-b border-slate-800">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 40 }}
        >
          {openTabs.map(tab => (
            <ChatTabHeader
              key={tab}
              id={tab}
              active={tab === activeTab}
              unread={unreadTabs.has(tab)}
              onSelect={() => setActiveTab(tab)}
              onClose={() => closeTab(tab)}
            />
          ))}
        </ScrollView>
      </View>

      <View className="flex-1">
        {isGuild ? (
          <View className="flex-1 items-center justify-center px-6 gap-2">
            <Text className="text-3xl">🏰</Text>
            <Text className="text-sm text-slate-400 text-center">
              Join a guild to enable this chat.
            </Text>
          </View>
        ) : (
          <FlatList
            data={activeMessages}
            inverted
            keyExtractor={item => item.messageId.toString()}
            contentContainerStyle={{ padding: 12, gap: 4 }}
            renderItem={({ item }) => (
              <ChatRow message={item} self={item.authorUsername === username} />
            )}
            ListEmptyComponent={
              <Text className="text-xs text-slate-500 text-center">
                {activeTab === 'party'
                  ? 'Party chat is empty. Messages go to your group.'
                  : activeIsWhisper
                    ? `Say hi to ${activePartner}.`
                    : 'No messages yet.'}
              </Text>
            }
          />
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3 py-2 border-t border-slate-800">
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSubmit}
          editable={!isGuild}
          placeholder={
            isGuild
              ? 'Guild chat unavailable'
              : activeIsWhisper
                ? `Whisper to ${activePartner}…`
                : activeTab === 'party'
                  ? 'Message party…'
                  : 'Message global…'
          }
          placeholderTextColor="#64748b"
          className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
            isGuild
              ? 'bg-slate-900 border-slate-800 text-slate-600'
              : 'bg-slate-900 border-slate-700 text-slate-100'
          }`}
          autoCapitalize="none"
          returnKeyType="send"
        />
        <Pressable
          onPress={onSubmit}
          disabled={isGuild || !input.trim()}
          className={`rounded-lg px-4 py-2 ${
            isGuild || !input.trim() ? 'bg-slate-800' : 'bg-emerald-500'
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              isGuild || !input.trim() ? 'text-slate-500' : 'text-slate-950'
            }`}
          >
            Send
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function tabLabel(id: TabId): string {
  if (id === 'global') return 'Global';
  if (id === 'party') return 'Party';
  if (id === 'guild') return 'Guild';
  return `@${id.slice('whisper:'.length)}`;
}

function ChatTabHeader({
  id,
  active,
  unread,
  onSelect,
  onClose,
}: {
  id: TabId;
  active: boolean;
  unread: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const labelClass = active
    ? 'text-amber-300 font-semibold'
    : unread
      ? 'text-sky-300 font-semibold'
      : 'text-slate-500';
  return (
    <View
      className={`flex-row items-center border-r border-slate-800 ${
        active ? 'bg-slate-950' : 'bg-slate-900'
      }`}
      style={
        active
          ? {
              borderTopWidth: 2,
              borderTopColor: '#fbbf24',
            }
          : undefined
      }
    >
      <Pressable
        onPress={onSelect}
        className="flex-row items-center pl-3 pr-1.5 py-2 gap-1.5"
      >
        {unread && !active ? (
          <View className="w-1.5 h-1.5 rounded-full bg-sky-400" />
        ) : null}
        <Text className={`text-xs ${labelClass}`} numberOfLines={1}>
          {tabLabel(id)}
        </Text>
      </Pressable>
      <Pressable onPress={onClose} hitSlop={6} className="pr-2.5 py-2">
        <Text className="text-[13px] text-slate-600 leading-none">×</Text>
      </Pressable>
    </View>
  );
}

function ChatRow({
  message,
  self,
}: {
  message: ChatMessage;
  self: boolean;
}) {
  return (
    <View className="flex-row items-baseline gap-1.5">
      <Text
        className={`text-xs font-semibold ${
          self ? 'text-amber-300' : 'text-slate-200'
        }`}
      >
        {message.authorUsername}
      </Text>
      <Text className="text-xs text-slate-100 flex-1">{message.body}</Text>
    </View>
  );
}
