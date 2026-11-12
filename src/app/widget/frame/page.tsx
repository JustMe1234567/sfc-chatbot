"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH } from "@/domain/limits";
import { distinctOptions, topicLabelsShadowedByOptions } from "@/domain/handoffOptions";
import { useClearFlow } from "./hooks/useClearFlow";
import { useContactGate } from "./hooks/useContactGate";
import { useConversationStream } from "./hooks/useConversationStream";
import { usePanelState } from "./hooks/usePanelState";
import { usePresence } from "./hooks/usePresence";
import { usePublishedContent, type TopicButton } from "./hooks/usePublishedContent";
import styles from "./frame.module.css";

function isHttpLink(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * The suggested-questions strip (ticket 18): a two-row, horizontally
 * scrollable rail pinned directly above the composer, rendered once the
 * conversation exists — the fresh state stacks its own suggestions instead
 * (ticket 46). Tracks where the horizontal overflow stands so a soft edge
 * fade can hint at more content without relying on a scrollbar that touch
 * devices hide.
 */
function TopicsStrip({
  topics,
  disabled,
  onPick,
}: {
  topics: TopicButton[];
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    // One-pixel tolerances keep sub-pixel scroll rounding from flickering
    // the fades on and off at either end.
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    setEdges({ start: strip.scrollLeft > 1, end: strip.scrollLeft < maxScroll - 1 });
  }, []);

  useEffect(() => {
    updateEdges();
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateEdges);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [updateEdges, topics.length]);

  return (
    <div className={styles.topicsShell}>
      <div
        ref={stripRef}
        className={styles.topics}
        role="group"
        aria-label="Suggested questions"
        onScroll={updateEdges}
      >
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className={styles.topicButton}
            disabled={disabled}
            onClick={() => onPick(topic.question)}
            onFocus={(event) => {
              event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            <span className={styles.topicLabel}>{topic.topic}</span>
          </button>
        ))}
      </div>
      <span
        className={`${styles.topicsFade} ${styles.fadeStart} ${edges.start ? styles.fadeOn : ""}`}
        aria-hidden="true"
      />
      <span
        className={`${styles.topicsFade} ${styles.fadeEnd} ${edges.end ? styles.fadeOn : ""}`}
        aria-hidden="true"
      />
    </div>
  );
}

export default function WidgetFrame() {
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // One hook per concern (ticket 33): the loader handshake and keyboard
  // focus, the presence heartbeat, the published settings, the conversation
  // stream, the contact gate, and the clear flow. The page composes them
  // and renders.
  const panel = usePanelState(inputRef, closeButtonRef);
  usePresence();
  const content = usePublishedContent();
  const stream = useConversationStream({
    panelOpen: panel.panelOpen,
    clearWelcome: content.clearWelcome,
    inputRef,
  });
  const gate = useContactGate({
    sessionRef: stream.sessionRef,
    dropSession: stream.dropSession,
    showLockedFreshChat: stream.showLockedFreshChat,
    setContactRequired: stream.setContactRequired,
    clearError: stream.clearError,
    hasMessages: stream.messages.length > 0,
    greet: content.greet,
    inputRef,
  });
  const clear = useClearFlow({
    sessionRef: stream.sessionRef,
    generationRef: stream.generationRef,
    dropSession: stream.dropSession,
    adoptSession: stream.adoptSession,
    bumpGeneration: stream.bumpGeneration,
    showLockedFreshChat: stream.showLockedFreshChat,
    showError: stream.showError,
    clearError: stream.clearError,
    setQuestion: stream.setQuestion,
    isSending: stream.isSending,
    requestClose: panel.requestClose,
  });

  const {
    messages,
    handoff,
    claimed,
    error,
    sending,
    contactRequired,
    question,
    setQuestion,
    arrivingIds,
    noticesArrive,
    send,
    dismissArrival,
  } = stream;
  const { topics, handoffOptions, chatbotIconSrc, welcome } = content;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!contactRequired) {
      inputRef.current?.focus();
    }
  }, [contactRequired]);

  // Staff help requested but nobody claimed yet: the composer locks (ticket
  // 43). Claiming — or a fresh conversation after Clear — re-enables it.
  const composerLocked = handoff && !claimed;

  // A configured option that spells the same suggestion as a published
  // rule's topic wins the shared chip (ticket 67): clicking it must notify
  // staff, so no duplicate chip renders for the same phrase. Repeated
  // spellings inside the configured list collapse to their first occurrence.
  const visibleHandoffOptions = distinctOptions(handoffOptions);
  const shadowedTopics = topicLabelsShadowedByOptions(
    topics.map((topic) => topic.topic),
    visibleHandoffOptions,
  );
  const visibleTopics = topics.filter((topic) => !shadowedTopics.has(topic.topic));

  // The click-to-handoff options (ticket 67): visible on the fresh chat and
  // again after bot answers; hidden while the visitor types a nonblank
  // question or a send/reply is pending — they return once the input is
  // cleared or the bot has answered — and gone for good in the waiting and
  // claimed states, where there is no second handoff to request. They
  // hide rather than disable: a chip that invites a staff handoff must not
  // linger as an affordance it can no longer honor.
  const handoffOptionsVisible =
    !contactRequired &&
    !sending &&
    !handoff &&
    !claimed &&
    question.trim().length === 0 &&
    visibleHandoffOptions.length > 0;

  // The fresh state (ticket 46): no transcript yet. It gets the reference's
  // composed layout — substantial header, greeting with avatar and
  // timestamp, stacked suggestions — and flips to the normal conversation
  // layout the moment the first visitor message exists.
  const freshStart = messages.length === 0;

  // The ticket-39 overflow menu, shared by both header compositions. Its
  // gating (only with messages) and behavior are unchanged; a genuinely
  // fresh chat has nothing to clear yet.
  const headerMenu = (
    <span className={styles.menuWrap}>
      <button
        ref={clear.menuButtonRef}
        type="button"
        className={styles.menuButton}
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={clear.menuOpen}
        disabled={sending || clear.clearState === "busy"}
        onClick={() => {
          if (!stream.isSending() && clear.clearState !== "busy") {
            clear.setMenuOpen((open) => !open);
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {clear.menuOpen ? (
        <span
          className={styles.menuPanel}
          role="menu"
          aria-label="Conversation options"
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              event.preventDefault();
              clear.menuItemRef.current?.focus();
            }
          }}
        >
          <button
            ref={clear.menuItemRef}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={sending || clear.clearState === "busy"}
            onClick={() => {
              if (stream.isSending() || clear.clearState === "busy") {
                return;
              }
              clear.setMenuOpen(false);
              clear.setClearState("confirm");
            }}
          >
            Clear conversation
          </button>
        </span>
      ) : null}
      {clear.clearState !== "idle" ? (
        <span
          className={styles.confirmBox}
          role="group"
          aria-label="Confirm clear conversation"
        >
          <span className={styles.confirmText}>
            Staff will keep a record of this chat on their side. You lose
            access to it here, and a fresh chat starts.
          </span>
          <span className={styles.confirmButtons}>
            <button
              ref={clear.confirmClearRef}
              type="button"
              className={styles.confirmClear}
              disabled={clear.clearState === "busy"}
              onClick={() => void clear.confirmClear()}
            >
              {clear.clearState === "busy" ? "Clearing…" : "Clear chat"}
            </button>
            <button
              type="button"
              className={styles.confirmKeep}
              disabled={clear.clearState === "busy"}
              onClick={() => {
                clear.setClearState("idle");
                clear.menuButtonRef.current?.focus();
              }}
            >
              Keep chatting
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );

  // The transcript's children, shared by the fresh and conversation layouts.
  // The greeting row (ticket 46) composes the reference's hierarchy: crest
  // avatar left, the bot bubble, then the subtle local timestamp. Still
  // presentation-only — announced by the log's live region, never stored.
  const logContent = (
    <>
      {welcome !== null ? (
        <li key="welcome" className={`${styles.messageFresh} ${styles.arrive}`}>
          <span className={styles.botAvatar} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={chatbotIconSrc}
              alt=""
              className={styles.botAvatarImg}
            />
          </span>
          <span className={`${styles.message} ${styles.bot} ${styles.welcomeBubble}`}>
            {welcome.text}
          </span>
          <time className={styles.welcomeTime} aria-hidden="true">
            {welcome.at}
          </time>
        </li>
      ) : null}
      {messages.map((message, index) => (
        <li
          key={message.id}
          className={`${styles.message} ${styles[message.role]}`}
          data-arrive={arrivingIds.has(message.id) ? "" : undefined}
          onAnimationEnd={
            arrivingIds.has(message.id)
              ? () => dismissArrival(message.id)
              : undefined
          }
        >
          {message.text}
          {message.link && isHttpLink(message.link) && (
            <a href={message.link} target="_blank" rel="noopener noreferrer">
              Visit the college page{" "}
              <span className={styles.srOnly}>(opens in a new tab)</span>
            </a>
          )}
          {index === messages.length - 1 && message.choices && !contactRequired ? (
            <div className={styles.choices}>
              {message.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={styles.topicButton}
                  disabled={sending || composerLocked}
                  onClick={() => void send(choice.topic, choice.id)}
                >
                  {choice.topic}
                </button>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </>
  );

  return (
    <main className={styles.panel}>
      {freshStart ? (
        // The reference's substantial header (ticket 46): the college identity
        // centered on its white plate, the close control at the corner. The
        // ticket-39 overflow menu appears with the conversation chrome — a
        // genuinely fresh chat has nothing to clear yet, and the menu's one
        // action needs a conversation to act on.
        <header className={`${styles.header} ${styles.headerFresh}`}>
          <span className={styles.headerFreshTop}>
            <button
              type="button"
              ref={closeButtonRef}
              className={styles.close}
              aria-label="Close chat"
              onClick={panel.requestClose}
            >
              &times;
            </button>
          </span>
          <span className={styles.brandPlate} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={chatbotIconSrc}
              alt=""
              className={styles.brandPlateImg}
            />
          </span>
          <span className={styles.brandNameFresh}>Springfield College</span>
        </header>
      ) : (
        <header className={styles.header}>
          <span className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chatbotIconSrc} alt="" className={styles.crest} />
            <span className={styles.title}>Chat with us</span>
          </span>
          <span className={styles.headerActions}>
            {messages.length > 0 ? headerMenu : null}
            <button
              type="button"
              ref={closeButtonRef}
              className={styles.close}
              aria-label="Close chat"
              onClick={panel.requestClose}
            >
              &times;
            </button>
          </span>
        </header>
      )}
      {visibleTopics.length === 0 && !contactRequired ? (
        // Only the topicless widget needs the guidance line (ticket 38): with
        // chips visible they are the affordance, and during a handoff the
        // notice below already says the bot has paused.
        <p className={styles.intro}>Ask us your question.</p>
      ) : null}
      {handoff ? (
        // The awaiting event's one live announcer (ticket 25): the takeover
        // is the service's core escalation event, so this paragraph carries
        // its announcement — the waiting line below stays purely visual,
        // since two polite regions firing together would read it twice.
        <p
          className={`${styles.handoff} ${noticesArrive ? styles.arrive : ""}`}
          role="status"
        >
          College staff will reply in this chat. Automated answers are paused.
        </p>
      ) : null}
      {claimed ? (
        // Announced once when staff take over (ticket 43) — the moment the
        // composer unlocks.
        <p
          className={`${styles.handoff} ${noticesArrive ? styles.arrive : ""}`}
          role="status"
        >
          A college staff member has joined the conversation and will reply here.
        </p>
      ) : null}
      {freshStart ? (
        // The fresh start area (ticket 46): greeting and stacked suggestions
        // scroll together while the composer stays put below.
        <div className={styles.startArea}>
          <ol
            className={`${styles.log} ${styles.logFresh}`}
            ref={logRef}
            role="log"
            aria-label="Messages"
            aria-live="polite"
          >
            {logContent}
          </ol>
          {!contactRequired && visibleTopics.length > 0 ? (
            <div
              className={`${styles.freshSuggestions} ${styles.arrive}`}
              role="group"
              aria-label="Suggested questions"
            >
              {visibleTopics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className={styles.freshSuggest}
                  disabled={sending || composerLocked}
                  onClick={() => void send(topic.question)}
                >
                  {topic.topic}
                </button>
              ))}
            </div>
          ) : null}
          {handoffOptionsVisible ? (
            // The click-to-handoff options (ticket 67), stacked in their
            // configured order: a click notifies staff and pauses the bot.
            <div
              className={`${styles.freshSuggestions} ${styles.arrive}`}
              role="group"
              aria-label="Options to reach our staff"
            >
              {visibleHandoffOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={styles.freshSuggest}
                  onClick={() => void send(option, undefined, true)}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <ol className={styles.log} ref={logRef} role="log" aria-label="Messages" aria-live="polite">
          {logContent}
        </ol>
      )}
      {/* The live region stays mounted so announcements are reliable; an
          empty region is zero-height, so it costs the transcript nothing
          while no error stands (ticket 38). A failed send is actionable
          now, not whenever (ticket 29), so it announces assertively. */}
      <p className={styles.status} role="alert">
        {error}
      </p>
      {composerLocked ? (
        // Visual companion to the handoff notice's announcement — ticket 43
        // made this line the announcer, ticket 25 moved that duty to the
        // notice above (one announcer per event, no double reading).
        <p className={styles.waiting}>Waiting for a staff member to take over…</p>
      ) : null}
      {!freshStart && !contactRequired && visibleTopics.length > 0 ? (
        // The compact persistent strip is the conversation's suggestion rail
        // (ticket 18); the fresh state stacks its own instead (ticket 46).
        <TopicsStrip
          topics={visibleTopics}
          disabled={sending || composerLocked}
          onPick={(question) => void send(question)}
        />
      ) : null}
      {!freshStart && handoffOptionsVisible ? (
        // The ongoing options rail (ticket 67): the conversation's own
        // click-to-handoff chips, in the same visual language as the
        // suggestion rail above, appearing and hiding with the same rules.
        <div className={styles.topicsShell}>
          <div className={styles.topics} role="group" aria-label="Options to reach our staff">
            {visibleHandoffOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.topicButton}
                onClick={() => void send(option, undefined, true)}
              >
                <span className={styles.topicLabel}>{option}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {contactRequired ? (
        // The gate (ticket 66): every new chat starts here — three clearly
        // labeled required fields and brief copy, with no way to dismiss it.
        // Closing the widget changes nothing: reopening shows the same form.
        <form className={styles.contactForm} onSubmit={gate.submitContact}>
          <p className={styles.contactIntro}>
            Please share your contact details to start this chat.
          </p>
          <label className={styles.contactLabel} htmlFor="sfcw-name">
            Full name
          </label>
          <input
            id="sfcw-name"
            className={styles.contactInput}
            autoComplete="name"
            required
            maxLength={MAX_NAME_LENGTH}
            placeholder="Jane Doe"
            value={gate.contact.fullName}
            onChange={(event) =>
              gate.setContact({ ...gate.contact, fullName: event.target.value })
            }
          />
          <label className={styles.contactLabel} htmlFor="sfcw-email">
            Email
          </label>
          <input
            id="sfcw-email"
            type="email"
            className={styles.contactInput}
            autoComplete="email"
            required
            placeholder="you@example.org"
            value={gate.contact.email}
            onChange={(event) =>
              gate.setContact({ ...gate.contact, email: event.target.value })
            }
          />
          <label className={styles.contactLabel} htmlFor="sfcw-phone">
            Phone
          </label>
          <input
            id="sfcw-phone"
            type="tel"
            className={styles.contactInput}
            autoComplete="tel"
            required
            placeholder="(555) 555-0100"
            value={gate.contact.phone}
            onChange={(event) =>
              gate.setContact({ ...gate.contact, phone: event.target.value })
            }
          />
          <button
            type="submit"
            className={styles.contactSubmit}
            disabled={gate.contactBusy}
            aria-busy={gate.contactBusy || undefined}
          >
            {gate.contactBusy ? (
              <>
                <span className={styles.pendingSpinner} aria-hidden="true" />
                Starting…
              </>
            ) : (
              "Start chat"
            )}
          </button>
          {gate.contactError ? (
            <p className={styles.contactError} role="alert">
              {gate.contactError}
            </p>
          ) : null}
        </form>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void send(question.trim());
          }}
        >
          <label className={styles.srOnly} htmlFor="sfcw-question">
            Your question
          </label>
          <textarea
            id="sfcw-question"
            ref={inputRef}
            className={styles.input}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Type your question"
            value={question}
            disabled={composerLocked}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            className={styles.send}
            disabled={sending || composerLocked}
            aria-busy={sending || undefined}
          >
            {sending ? (
              // Conversation-first pending feedback (ticket 42): the active
              // verb plus the shared spinner pattern, locally styled because
              // the iframe is self-contained (ticket 16).
              <>
                <span className={styles.pendingSpinner} aria-hidden="true" />
                Sending…
              </>
            ) : (
              "Send"
            )}
          </button>
        </form>
      )}
    </main>
  );
}
