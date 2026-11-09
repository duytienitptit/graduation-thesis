'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { TaskChat } from '@/components/task-chat';
import { TaskFinish } from '@/components/task-finish';
import { useTaskRoom } from '@/lib/use-task-room';
import { useUser } from '@/lib/use-user';

export default function DesignerTaskPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const room = useTaskRoom(id);
  const { task, error } = room;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-8">
      <AppHeader user={user} />

      <main className="mt-8">
        <Link
          href="/designer"
          className="text-sm font-medium text-cobalt outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Về khu vực designer
        </Link>

        {error && (
          <ErrorNote>
            {error.status === 403 || error.status === 404
              ? 'Không tìm thấy task này, hoặc task không phải của bạn.'
              : error.message}
          </ErrorNote>
        )}

        {task && (
          <>
            <h1 className="overprint mt-4 text-5xl font-extrabold sm:text-6xl">
              {task.product.name}
            </h1>
            <p className="mt-3 text-muted-foreground">
              Khách: {task.customerName}. {task.product.colour}, {task.product.material.toLowerCase()}
              , size {task.product.size}, số lượng {task.product.quantity}
            </p>

            {task.targetView && (
              <p className="mt-4 border-l-4 border-cobalt pl-3 font-medium">
                Chỉ làm một góc: {task.targetView.label}. Mặt trước khách đã chốt, ảnh của bạn sẽ vào
                góc này để khách duyệt.
              </p>
            )}

            {task.status === 'CLOSED' && (
              <p role="status" className="mt-4 border-l-4 border-cobalt pl-3 font-medium">
                Task đã đóng. Lý do: {task.closeReason}
              </p>
            )}

            {task.status === 'DONE' && (
              <p role="status" className="mt-4 border-l-4 border-cobalt pl-3 font-medium">
                Task đã hoàn thành. Bạn đã trở lại trạng thái rảnh nếu không bị tạm dừng.
              </p>
            )}

            <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
              <div className="md:order-2">
                <TaskChat room={room} />
                {task.status === 'ASSIGNED' && (
                  <TaskFinish task={task} reload={room.reloadTask} />
                )}
              </div>

              <aside aria-label="Thông tin khách gửi" className="md:order-1">
                <h2 className="font-semibold">Khách cần</h2>
                <p className="mt-1 whitespace-pre-wrap" data-testid="task-requirement">
                  {task.requirement}
                </p>

                <h2 className="mt-6 font-semibold">
                  {task.targetView ? 'Mặt trước khách đã chốt' : 'Ảnh AI khách gửi'}
                </h2>
                {/* eslint-disable-next-line @next/next/no-img-element -- expiring storage link */}
                <img
                  src={task.referenceImageUrl}
                  alt="Ảnh AI khách gửi"
                  className="mt-2 aspect-square w-full border border-mist bg-white object-contain"
                />

                {task.uploads.length > 0 && (
                  <>
                    <h2 className="mt-6 font-semibold">Ảnh khách tải lên</h2>
                    <ul className="mt-2 grid grid-cols-3 gap-2">
                      {task.uploads.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- expiring storage link */}
                            <img
                              src={url}
                              alt="Ảnh khách tải lên"
                              className="aspect-square w-full border border-mist bg-white object-contain"
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h2 className="mt-6 font-semibold">Câu trả lời của khách</h2>
                <dl className="mt-2 divide-y divide-mist border-y border-mist text-sm">
                  {task.answers.map((answer) => (
                    <div key={answer.id} className="py-2">
                      <dt className="text-muted-foreground">{answer.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap font-medium">{answer.text}</dd>
                    </div>
                  ))}
                </dl>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
