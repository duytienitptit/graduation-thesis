'use client';

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ErrorNote } from '@/components/error-note';
import { Button } from '@/components/ui/button';
import {
  agreeToSample,
  ApiError,
  sendSample,
  sendTaskMessage,
  TaskDetail,
  TaskMessage,
  uploadChatFile,
  uploadChatImage,
} from '@/lib/api';
import { TaskRoom, useTaskRoom } from '@/lib/use-task-room';

const sentAt = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));

function ChatImage({ url, alt }: { url: string; alt: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
      {/* eslint-disable-next-line @next/next/no-img-element -- expiring storage link */}
      <img src={url} alt={alt} className="max-h-72 w-full border border-mist bg-white object-contain" />
    </a>
  );
}

function Attachment({ attachment }: { attachment: NonNullable<TaskMessage['attachment']> }) {
  if (attachment.mimeType.startsWith('image/')) {
    return <ChatImage url={attachment.url} alt="Ảnh đính kèm" />;
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-block font-medium text-cobalt underline underline-offset-2"
    >
      Mở tệp PDF
    </a>
  );
}

interface BubbleProps {
  message: TaskMessage;
  task: TaskDetail;
  busy: boolean;
  onAgree: (versionId: string) => void;
}

function Bubble({ message, task, busy, onAgree }: BubbleProps) {
  const own = message.senderRole === task.side;
  const agreed = !!message.versionId && message.versionId === task.agreedVersionId;
  // A view task is approved at the views step instead.
  const canAgree =
    task.side === 'CUSTOMER' && task.status === 'ASSIGNED' && !agreed && !task.targetView;
  const final = message.kind === 'FINAL';
  const current = final && message.versionId === task.finalVersionId;

  return (
    <li
      data-testid={`message-${message.kind}`}
      className={`max-w-[85%] border px-3 py-2 ${
        own ? 'ml-auto border-cobalt/40 bg-cobalt/5' : 'mr-auto border-mist bg-white'
      }`}
    >
      <p className="text-xs text-muted-foreground">
        {message.senderName}, {sentAt(message.createdAt)}
      </p>

      {message.kind === 'SAMPLE' && <p className="mt-1 text-sm font-semibold">Ảnh mẫu</p>}
      {final && (
        <p className="mt-1 text-sm font-semibold">
          Bản cuối{!current && task.status === 'ASSIGNED' ? ' (đã thay bằng bản khác)' : ''}
        </p>
      )}

      {message.imageUrl && (
        <ChatImage url={message.imageUrl} alt={final ? 'Bản cuối' : 'Ảnh mẫu'} />
      )}

      {message.text && (
        <p className="mt-1 whitespace-pre-wrap break-words">
          {final && <span className="font-medium">Mặt sau: </span>}
          {message.text}
        </p>
      )}

      {final && message.attachment && (
        <p className="mt-2 text-sm font-medium">Ảnh mặt sau</p>
      )}
      {message.attachment && <Attachment attachment={message.attachment} />}

      {message.kind === 'SAMPLE' && agreed && (
        <p role="status" className="mt-2 text-sm font-medium text-cobalt">
          {task.side === 'CUSTOMER' ? 'Bạn đã đồng ý mẫu này' : 'Khách đã đồng ý mẫu này'}
        </p>
      )}
      {message.kind === 'SAMPLE' && canAgree && (
        <Button size="sm" className="mt-2" disabled={busy} onClick={() => onAgree(message.versionId!)}>
          Đồng ý mẫu này
        </Button>
      )}
    </li>
  );
}

const failureText = (e: unknown) => {
  const failure = e as ApiError;
  return failure.status === 409 ? 'Task này đã kết thúc, không gửi được nữa.' : failure.message;
};

export function TaskChat({ room }: { room: TaskRoom }) {
  const { task, messages } = room;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // Follows the newest message, unless the person has scrolled up to read.
  const following = useRef(true);
  const lastTop = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);

  const follow = () => {
    if (following.current) list.current?.scrollTo({ top: list.current.scrollHeight });
  };

  useEffect(follow, [messages.length]);

  if (!task) return null;

  const taskId = task.id;
  const open = task.status === 'ASSIGNED' && task.side !== 'MANAGER';
  const designer = task.side === 'DESIGNER';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setText('');
      return true;
    } catch (e) {
      setError(failureText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function agree(versionId: string) {
    setBusy(true);
    setError(null);
    try {
      await agreeToSample(taskId, versionId);
      await room.reloadTask();
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  }

  function onScroll() {
    const box = list.current;
    if (!box) return;
    // Only moving up stops following: an image loading also leaves the view above the bottom.
    if (box.scrollTop < lastTop.current) following.current = false;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) following.current = true;
    lastTop.current = box.scrollTop;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (text.trim()) void run(() => sendTaskMessage(taskId, { text }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      const fileId = await uploadChatFile(file);
      await sendTaskMessage(taskId, { fileId, text: text.trim() || undefined });
    });
  }

  function onSample(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      const fileId = await uploadChatImage(file, 'CHAT');
      await sendSample(taskId, fileId, text.trim() || undefined);
    });
  }

  return (
    <div data-testid="task-chat">
      <ol
        ref={list}
        aria-label="Tin nhắn"
        aria-live="polite"
        onScroll={onScroll}
        // Images grow the list after it first renders.
        onLoadCapture={follow}
        className="flex h-[28rem] flex-col gap-3 overflow-y-auto border border-mist bg-background p-3"
      >
        {messages.length === 0 && (
          <li className="m-auto text-center text-sm text-muted-foreground">Chưa có tin nhắn nào.</li>
        )}
        {messages.map((message) => (
          <Bubble key={message.id} message={message} task={task} busy={busy} onAgree={agree} />
        ))}
      </ol>

      {error && <ErrorNote>{error}</ErrorNote>}

      {open ? (
        <form onSubmit={submit} className="mt-3">
          <label htmlFor="chat-text" className="sr-only">
            Tin nhắn
          </label>
          <textarea
            id="chat-text"
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={designer ? 'Nhắn cho khách' : 'Nhắn cho designer'}
            className="block w-full border border-mist bg-white px-3 py-2 outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            aria-label="Chọn tệp để gửi"
            data-testid="chat-file"
            className="hidden"
            onChange={onFile}
          />
          <input
            ref={sampleInput}
            type="file"
            accept="image/png,image/jpeg"
            aria-label="Chọn ảnh mẫu"
            data-testid="chat-sample"
            className="hidden"
            onChange={onSample}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !text.trim()}>
              Gửi
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Gửi tệp
            </Button>
            {designer && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => sampleInput.current?.click()}
              >
                Gửi ảnh mẫu
              </Button>
            )}
            <p className="text-xs text-muted-foreground">PNG, JPG hoặc PDF, tối đa 10 MB</p>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {task.status === 'CLOSED'
            ? 'Chat đã đóng vì designer đã đóng task.'
            : task.status === 'ASSIGNED'
              ? 'Bạn chỉ xem được chat này.'
              : 'Chat đã đóng vì task đã hoàn thành.'}
        </p>
      )}
    </div>
  );
}

/** The customer's chat, with what was sent to the designer beside it while they work. */
export function TaskChatPanel({ taskId, withBrief }: { taskId: string; withBrief?: boolean }) {
  const room = useTaskRoom(taskId);
  const { task, error } = room;

  const chat = (
    <div>
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {task?.status === 'ASSIGNED' && task.targetView && task.finalVersionId && (
        <p role="status" className="mb-3 border-l-4 border-cobalt pl-3 text-sm">
          Designer đã gửi ảnh góc này. Khi designer bấm hoàn thành, ảnh sẽ vào góc để bạn duyệt.
        </p>
      )}
      {task?.status === 'ASSIGNED' && !task.targetView && task.agreedVersionId && (
        <p role="status" className="mb-3 border-l-4 border-cobalt pl-3 text-sm">
          {task.finalVersionId
            ? 'Designer đã gửi bản cuối. Khi designer bấm hoàn thành, hệ thống sẽ tạo các góc còn lại.'
            : 'Bạn đã đồng ý một mẫu. Designer sẽ gửi bản cuối.'}
        </p>
      )}
      <TaskChat room={room} />
    </div>
  );

  if (!withBrief) return <div className="mt-4">{chat}</div>;

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      {chat}
      {task && (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- expiring storage link */}
          <img
            src={task.referenceImageUrl}
            alt="Ảnh AI gửi cho designer"
            className="aspect-square w-full border border-mist bg-white object-contain"
          />
          <p className="mt-4 text-sm font-semibold">Yêu cầu của bạn</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {task.requirement}
          </p>
        </div>
      )}
    </div>
  );
}
