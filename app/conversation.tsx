'use client';
import { Fragment, useState, type FormEvent, type ReactNode, type RefObject, type UIEvent } from 'react';
import type { Message, ServerDetail, User } from '@/lib/types';
import { Avatar, ghostButton, Icon, iconButton } from './ui';

/** Ce qui s'affiche au centre : un salon de serveur ou une conversation privée. */
export type Conversation = { id: number; name: string; dm?: User };

const GROUP_MS = 5 * 60_000; // messages consécutifs d'un même auteur regroupés sous 5 min

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(t: number) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(t, Date.now())) return "Aujourd'hui";
  if (sameDay(t, yesterday.getTime())) return 'Hier';
  return new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function ConversationView({ conversation, server, messages, hasMore, canSend, boxRef, inputRef, onScroll, onSend, onInvite, authorColor, typing, onTyping, onCall, callArea }: {
  conversation: Conversation;
  server: ServerDetail | null;
  messages: Message[];
  hasMore: boolean;
  canSend: boolean;
  boxRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  onSend: (body: string) => Promise<boolean>;
  onInvite?: () => void;
  authorColor: (m: Message) => string;
  typing: string[];                         // pseudos des personnes en train d'écrire
  onTyping: () => void;                     // appelé à chaque frappe (le parent limite la cadence)
  onCall?: (video: boolean) => void;        // conversation privée : lancer un appel
  callArea?: ReactNode;                     // bandeau de l'appel privé en cours
}) {
  const [draft, setDraft] = useState('');
  const { dm } = conversation;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = draft;
    if (!body.trim()) return;
    setDraft('');
    if (!(await onSend(body))) setDraft(body);
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        {dm ? <Avatar user={dm} className="size-7 text-xs" /> : <Icon name="hash" className="size-5 shrink-0 text-subtle" />}
        <h1 className="truncate font-semibold">{conversation.name}</h1>
        <span className="hidden h-5 w-px bg-line md:block" />
        <span className="hidden truncate text-sm text-muted md:block">{dm ? 'Message privé' : server?.name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {server && (
            <span className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted xl:hidden">
              <Icon name="users" className="size-4" /> {server.members.length}
            </span>
          )}
          {onInvite && (
            <button onClick={onInvite} className={ghostButton}>
              <Icon name="userPlus" className="size-4" /> Inviter
            </button>
          )}
          {onCall && (
            <>
              <button aria-label="Appel vocal" title="Lancer un appel vocal" onClick={() => onCall(false)} className={`${iconButton} size-9`}>
                <Icon name="phone" className="size-[18px]" />
              </button>
              <button aria-label="Appel vidéo" title="Lancer un appel vidéo" onClick={() => onCall(true)} className={`${iconButton} size-9`}>
                <Icon name="video" className="size-[18px]" />
              </button>
            </>
          )}
        </div>
      </header>
      {callArea}

      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end pb-6" aria-live="polite">
          {!hasMore && (
            <div className="px-6 pt-12 pb-4">
              {dm ? (
                <Avatar user={dm} className="size-20 text-3xl" />
              ) : (
                <div className="grid size-16 place-items-center rounded-2xl bg-linear-to-br from-accent/30 to-accent-2/20 text-fg ring-1 ring-white/10">
                  <Icon name="hash" className="size-8" />
                </div>
              )}
              <h2 className="mt-5 text-3xl font-bold tracking-tight">{dm ? dm.name : `Bienvenue dans #${conversation.name}`}</h2>
              <p className="mt-1.5 text-muted">
                {dm
                  ? <>C&apos;est le tout début de ta conversation privée avec <b className="text-fg">{dm.name}</b>.</>
                  : <>C&apos;est le tout début du salon #{conversation.name} de {server?.name}.</>}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(prev.created_at, m.created_at);
            const head = newDay || prev.user_id !== m.user_id || m.created_at - prev.created_at > GROUP_MS;
            return (
              <Fragment key={m.id}>
                {newDay && <DaySeparator>{dayLabel(m.created_at)}</DaySeparator>}
                <article className={`group flex animate-rise gap-4 px-6 py-0.5 transition-colors hover:bg-white/[0.025] ${head ? 'mt-3 pt-1.5' : ''}`}>
                  {head ? (
                    <Avatar user={{ id: m.user_id, name: m.name, avatar: m.avatar }} className="mt-0.5 size-10 text-sm" />
                  ) : (
                    <time className="w-10 shrink-0 pt-1 text-right text-[10px] text-subtle opacity-0 transition group-hover:opacity-100">
                      {clock(m.created_at)}
                    </time>
                  )}
                  <div className="min-w-0 flex-1">
                    {head && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold" style={{ color: authorColor(m) }}>{m.name}</span>
                        <time className="text-xs text-subtle">{dayLabel(m.created_at)} à {clock(m.created_at)}</time>
                      </div>
                    )}
                    <p className="leading-relaxed wrap-anywhere whitespace-pre-wrap text-fg/90">{m.body}</p>
                  </div>
                </article>
              </Fragment>
            );
          })}
        </div>
      </div>

      <form onSubmit={submit} className="px-6 pb-5">
        {canSend ? (
          <>
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-ink-800/80 p-2 pl-4 shadow-lg shadow-black/20 transition focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (e.target.value) onTyping(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                maxLength={2000}
                placeholder={dm ? `Envoyer un message à @${dm.name}` : `Envoyer un message dans #${conversation.name}`}
                aria-label="Message"
                className="max-h-48 flex-1 resize-none bg-transparent py-1.5 leading-relaxed outline-none field-sizing-content placeholder:text-subtle"
              />
              <button
                aria-label="Envoyer"
                disabled={!draft.trim()}
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-accent to-accent-2 text-white shadow-md shadow-accent/30 transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-30 disabled:shadow-none"
              >
                <Icon name="send" className="size-4" />
              </button>
            </div>
            <p className="mt-1.5 flex h-4 items-center gap-1.5 px-1 text-[11px] text-subtle">
              {typing.length ? (
                <span className="flex items-center gap-1.5 text-muted" aria-live="polite">
                  <TypingDots />
                  <b className="font-semibold text-fg">{typingLabel(typing)}</b>
                </span>
              ) : (
                <>
                  <kbd className="font-sans font-medium text-muted">Entrée</kbd> pour envoyer · <kbd className="font-sans font-medium text-muted">Maj + Entrée</kbd> pour un retour à la ligne
                </>
              )}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-ink-800/40 px-4 py-3.5 text-sm text-subtle">
            <Icon name="shield" className="size-4 shrink-0" /> Tu n&apos;as pas la permission d&apos;envoyer des messages dans ce salon.
          </div>
        )}
      </form>
    </>
  );
}

/** « lea est en train d'écrire… », « lea et samir écrivent… », « Plusieurs personnes écrivent… » */
const typingLabel = (names: string[]) =>
  names.length === 1 ? `${names[0]} est en train d'écrire…`
    : names.length <= 3 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)} écrivent…`
      : 'Plusieurs personnes écrivent…';

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[0, 150, 300].map((delay) => <span key={delay} className="size-1 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />)}
    </span>
  );
}

function DaySeparator({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 flex items-center gap-3 px-6 text-[11px] font-semibold tracking-wide text-subtle uppercase">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
