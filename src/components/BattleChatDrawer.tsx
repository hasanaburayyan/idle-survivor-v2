import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import SafePressable from './SafePressable';

const COLLAPSED_WIDTH = 24;
const EXPANDED_WIDTH = 240;

interface BattleChatDrawerProps {
  username: string;
}

type Channel = 'party' | 'global';

interface ChatRow {
  messageId: bigint;
  authorUsername: string;
  body: string;
}

export default function BattleChatDrawer({ username }: BattleChatDrawerProps) {
  const [partyMessages] = useTable(tables.myPartyChat);
  const [globalMessages] = useTable(tables.myGlobalChat);
  const send = useReducer(reducers.sendChatMessage);

  const [expanded, setExpanded] = useState(false);
  const [channel, setChannel] = useState<Channel>('party');
  const [input, setInput] = useState('');
  const [unreadParty, setUnreadParty] = useState(0);
  const [unreadGlobal, setUnreadGlobal] = useState(0);
  const lastSeenPartyRef = useRef<bigint>(0n);
  const lastSeenGlobalRef = useRef<bigint>(0n);

  const widthAnim = useRef(new Animated.Value(COLLAPSED_WIDTH)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, widthAnim]);

  const sortedParty = useMemo(
    () =>
      [...partyMessages].sort((a, b) =>
        a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0
      ) as ChatRow[],
    [partyMessages]
  );
  const sortedGlobal = useMemo(
    () =>
      [...globalMessages].sort((a, b) =>
        a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0
      ) as ChatRow[],
    [globalMessages]
  );

  // Initialize "last seen" to the highest id at mount so we don't flag
  // pre-existing history as unread.
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const maxId = (rows: ChatRow[]) =>
      rows.reduce((m, r) => (r.messageId > m ? r.messageId : m), 0n);
    lastSeenPartyRef.current = maxId(sortedParty);
    lastSeenGlobalRef.current = maxId(sortedGlobal);
  }, [sortedParty, sortedGlobal]);

  // Track unread; clear the active channel's count when expanded.
  useEffect(() => {
    const countNew = (rows: ChatRow[], lastSeen: bigint) =>
      rows.reduce(
        (n, r) => (r.messageId > lastSeen && r.authorUsername !== username ? n + 1 : n),
        0
      );

    if (expanded && channel === 'party') {
      lastSeenPartyRef.current = sortedParty[0]?.messageId ?? lastSeenPartyRef.current;
      setUnreadParty(0);
    } else {
      setUnreadParty(countNew(sortedParty, lastSeenPartyRef.current));
    }

    if (expanded && channel === 'global') {
      lastSeenGlobalRef.current = sortedGlobal[0]?.messageId ?? lastSeenGlobalRef.current;
      setUnreadGlobal(0);
    } else {
      setUnreadGlobal(countNew(sortedGlobal, lastSeenGlobalRef.current));
    }
  }, [sortedParty, sortedGlobal, expanded, channel, username]);

  const totalUnread = unreadParty + unreadGlobal;
  const messages = channel === 'party' ? sortedParty : sortedGlobal;

  const onSubmit = () => {
    const text = input.trim();
    if (!text) return;
    send({ channelType: channel, targetUsername: '', body: text }).catch(() => {});
    setInput('');
  };

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: widthAnim,
        zIndex: 10,
      }}
      className="border-r border-slate-800 bg-slate-950/95"
    >
      {expanded ? (
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-2 py-1.5 border-b border-slate-800">
            <View className="flex-row gap-1">
              <SafePressable
                onPress={() => setChannel('party')}
                className={`rounded-md px-2 py-0.5 ${
                  channel === 'party' ? 'bg-amber-500/20' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={`text-[10px] uppercase tracking-widest ${
                    channel === 'party' ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  Party{unreadParty > 0 && channel !== 'party' ? ` ·${unreadParty}` : ''}
                </Text>
              </SafePressable>
              <SafePressable
                onPress={() => setChannel('global')}
                className={`rounded-md px-2 py-0.5 ${
                  channel === 'global' ? 'bg-amber-500/20' : 'bg-slate-800'
                }`}
              >
                <Text
                  className={`text-[10px] uppercase tracking-widest ${
                    channel === 'global' ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  Global{unreadGlobal > 0 && channel !== 'global' ? ` ·${unreadGlobal}` : ''}
                </Text>
              </SafePressable>
            </View>
            <SafePressable
              onPress={() => setExpanded(false)}
              className="rounded-md bg-slate-800 px-2 py-0.5"
            >
              <Text className="text-[10px] text-slate-300">‹</Text>
            </SafePressable>
          </View>
          <FlatList
            data={messages}
            inverted
            keyExtractor={item => item.messageId.toString()}
            contentContainerStyle={{ padding: 6, gap: 3 }}
            renderItem={({ item }) => (
              <View className="flex-row items-baseline gap-1">
                <Text
                  className={`text-[11px] font-semibold ${
                    item.authorUsername === username ? 'text-amber-300' : 'text-slate-200'
                  }`}
                >
                  {item.authorUsername}
                </Text>
                <Text className="text-[11px] text-slate-100 flex-1">{item.body}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text className="text-[11px] text-slate-500">
                {channel === 'party' ? 'Party chat is empty.' : 'No messages yet.'}
              </Text>
            }
          />
          <View className="flex-row items-center gap-1.5 px-2 py-1.5 border-t border-slate-800">
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={onSubmit}
              placeholder={channel === 'party' ? 'Message party…' : 'Message global…'}
              placeholderTextColor="#64748b"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
              autoCapitalize="none"
              returnKeyType="send"
            />
            <SafePressable
              onPress={onSubmit}
              disabled={!input.trim()}
              className={`rounded-md px-2 py-1 ${
                input.trim() ? 'bg-emerald-500' : 'bg-slate-800'
              }`}
            >
              <Text
                className={`text-[11px] font-semibold ${
                  input.trim() ? 'text-slate-950' : 'text-slate-500'
                }`}
              >
                ↵
              </Text>
            </SafePressable>
          </View>
        </View>
      ) : (
        <SafePressable
          onPress={() => setExpanded(true)}
          className="flex-1 items-center justify-center"
          accessibilityLabel={`Open chat${totalUnread > 0 ? `, ${totalUnread} unread` : ''}`}
        >
          <Text
            className="text-[10px] uppercase tracking-widest text-slate-500"
            style={{
              transform: [{ rotate: '90deg' }],
            }}
          >
            CHAT
          </Text>
          {totalUnread > 0 ? (
            <View className="absolute top-1 right-1 min-w-[14px] h-[14px] items-center justify-center rounded-full bg-sky-400 px-1">
              <Text className="text-[9px] font-semibold text-slate-950">
                {totalUnread > 9 ? '9+' : totalUnread}
              </Text>
            </View>
          ) : null}
        </SafePressable>
      )}
    </Animated.View>
  );
}
