const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'auth-token';

export type Role = 'CUSTOMER' | 'DESIGNER' | 'MANAGER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: 'Khách hàng',
  DESIGNER: 'Designer',
  MANAGER: 'Quản lí',
};

export interface AnswerError {
  questionId: string;
  code: 'unknown' | 'invalid' | 'too-long' | 'too-many-files' | 'required';
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly answerErrors: AnswerError[] = [],
    readonly code?: string,
  ) {
    super(message);
  }
}

export const apiUrl = API_URL;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => {
    throw new ApiError('Không kết nối được máy chủ. Hãy kiểm tra API đã chạy chưa rồi thử lại.');
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(`Máy chủ từ chối yêu cầu (mã ${res.status}).`, res.status, body?.errors, body?.code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const listDevUsers = () => api<User[]>('/auth/dev-users');

export const getMe = () => api<User>('/auth/me');

export async function devLogin(email: string) {
  const { token } = await api<{ token: string }>('/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  setToken(token);
}

export interface Option {
  id: string;
  name: string;
}

export interface Product extends Option {
  shirtType: string;
  colours: (Option & { hex: string })[];
  materials: Option[];
  sizes: string[];
}

export type Answers = Record<string, string | string[]>;

export type SessionStatus = 'ANSWERING' | 'ANSWERED' | 'VIEWS' | 'LOCKED' | 'DESIGNER';

export interface DesignSession {
  id: string;
  status: SessionStatus;
  answers: Answers;
  createdAt: string;
  specSnapshot: {
    product: Option & { shirtType: string };
    colour: Option & { hex: string };
    material: Option;
    size: string;
    quantity: number;
  };
}

interface BaseQuestion {
  id: string;
  label: string;
  required: boolean;
  visibleWhen?: { questionId: string; equals: string };
}

export type Question = BaseQuestion &
  (
    | { type: 'choice'; options: { value: string; label: string }[] }
    | { type: 'text' | 'longText'; placeholder?: string }
    | { type: 'upload'; maxFiles: number }
  );

export interface QuestionSet {
  sections: { title: string; questions: Question[] }[];
}

export const listProducts = () => api<Product[]>('/catalog/products');

export const listSessions = () => api<DesignSession[]>('/design/sessions');

export const getSession = (id: string) => api<DesignSession>(`/design/sessions/${id}`);

export const getQuestions = (productId: string) =>
  api<QuestionSet>(`/design/products/${productId}/questions`);

export const createSession = (specs: {
  productId: string;
  colourId: string;
  materialId: string;
  size: string;
  quantity: number;
}) => api<DesignSession>('/design/sessions', { method: 'POST', body: JSON.stringify(specs) });

export const saveAnswers = (id: string, answers: Answers) =>
  api<DesignSession>(`/design/sessions/${id}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  });

export const submitAnswers = (id: string) =>
  api<DesignSession>(`/design/sessions/${id}/answers/submit`, { method: 'POST' });

export const getImageUrl = async (fileId: string) =>
  (await api<{ url: string }>(`/files/${fileId}/download-url`)).url;

export interface DesignVersion {
  id: string;
  parentVersionId: string | null;
  source: 'AI' | 'DESIGNER';
  editRequest: string | null;
  createdAt: string;
  imageUrl: string;
}

export interface ProductView {
  id: string;
  type: 'FRONT' | 'BACK' | 'CLOSE_UP' | 'EXTRA';
  position: number;
  status: 'PENDING' | 'READY' | 'APPROVED';
  description: string | null;
  jobStatus: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | null;
  imageUrl: string | null;
  /** The latest designer task for this view, if any. */
  task: DesignTask | null;
}

export type TaskStatus = 'WAITING' | 'ASSIGNED' | 'DONE' | 'CANCELLED' | 'CLOSED';

export interface DesignTask {
  id: string;
  status: TaskStatus;
  requirement: string;
  designerName: string | null;
  waitReason: 'out-of-hours' | 'no-free-designer' | null;
  noTakerNotice: boolean;
  cancellableAt: string;
  closeReason: string | null;
}

export const isOpenTask = (task: DesignTask | null | undefined) =>
  task?.status === 'WAITING' || task?.status === 'ASSIGNED';

export interface Workspace {
  status: SessionStatus;
  lockedProductId: string | null;
  task: DesignTask | null;
  views: ProductView[];
  versions: DesignVersion[];
  latestJob: {
    id: string;
    kind: 'CREATE' | 'EDIT';
    status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  } | null;
  usage: { used: number; limit: number; remaining: number; resetsAt: string };
}

export const getWorkspace = (id: string) => api<Workspace>(`/design/sessions/${id}/workspace`);

export const createImage = (id: string) =>
  api<{ id: string }>(`/design/sessions/${id}/images`, { method: 'POST' });

export const editImage = (id: string, versionId: string, request: string) =>
  api<{ id: string }>(`/design/sessions/${id}/edits`, {
    method: 'POST',
    body: JSON.stringify({ versionId, request }),
  });

export const createViewTask = (id: string, viewId: string, requirement: string) =>
  api<unknown>(`/design/sessions/${id}/views/${viewId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ requirement }),
  });

export const cancelTask = (id: string) => api<void>(`/tasks/${id}/cancel`, { method: 'POST' });

export const closeTask = (id: string, reason: string) =>
  api<void>(`/tasks/${id}/close`, { method: 'POST', body: JSON.stringify({ reason }) });

export const createTask = (id: string, versionId: string, requirement: string) =>
  api<unknown>(`/design/sessions/${id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ versionId, requirement }),
  });

export interface DesignerSummary {
  state: 'FREE' | 'BUSY' | 'PAUSED';
  telegramLinked: boolean;
  telegramUsername: string | null;
}

export const getDesignerMe = () => api<DesignerSummary>('/designers/me');

export interface DesignerTaskRow {
  id: string;
  status: DesignTask['status'];
  requirement: string;
  productName: string;
  customerName: string;
  assignedAt: string | null;
  doneAt: string | null;
  closedAt: string | null;
  viewLabel: string | null;
}

export const getDesignerTasks = () =>
  api<{ current: DesignerTaskRow | null; past: DesignerTaskRow[] }>('/designers/me/tasks');

export interface TaskDetail {
  id: string;
  side: 'CUSTOMER' | 'DESIGNER' | 'MANAGER';
  status: DesignTask['status'];
  sessionId: string;
  requirement: string;
  customerName: string;
  designerName: string | null;
  closeReason: string | null;
  targetView: { type: string; label: string } | null;
  product: { name: string; colour: string; material: string; size: string; quantity: number };
  referenceImageUrl: string;
  answers: { id: string; label: string; text: string }[];
  uploads: string[];
  agreedVersionId: string | null;
  finalVersionId: string | null;
  finalImageUrl: string | null;
  backDescription: string | null;
  backImageUrl: string | null;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  senderName: string;
  senderRole: Role;
  kind: 'TEXT' | 'FILE' | 'SAMPLE' | 'FINAL';
  text: string | null;
  versionId: string | null;
  createdAt: string;
  imageUrl: string | null;
  attachment: { url: string; mimeType: string } | null;
}

export const getTask = (id: string) => api<TaskDetail>(`/tasks/${id}`);

export const getTaskMessages = (id: string) => api<TaskMessage[]>(`/tasks/${id}/messages`);

export const sendTaskMessage = (id: string, message: { text?: string; fileId?: string }) =>
  api<TaskMessage>(`/tasks/${id}/messages`, { method: 'POST', body: JSON.stringify(message) });

export const sendSample = (id: string, fileId: string, text?: string) =>
  api<TaskMessage>(`/tasks/${id}/samples`, {
    method: 'POST',
    body: JSON.stringify({ fileId, text }),
  });

export const agreeToSample = (id: string, versionId: string) =>
  api<void>(`/tasks/${id}/agree`, { method: 'POST', body: JSON.stringify({ versionId }) });

export const sendFinal = (
  id: string,
  final: { fileId: string; backDescription?: string; backFileId?: string },
) => api<TaskMessage>(`/tasks/${id}/final`, { method: 'POST', body: JSON.stringify(final) });

export const finishTask = (id: string) => api<void>(`/tasks/${id}/done`, { method: 'POST' });

export const createTelegramLink = () =>
  api<{ url: string; expiresAt: string }>('/designers/me/telegram-link', { method: 'POST' });

export const chooseMainImage = (id: string, versionId: string) =>
  api<unknown>(`/design/sessions/${id}/main-image`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });

const viewAction = (action: string) => (id: string, viewId: string) =>
  api<unknown>(`/design/sessions/${id}/views/${viewId}/${action}`, { method: 'POST' });

export const generateView = viewAction('generate');
export const regenerateView = viewAction('regenerate');
export const approveView = viewAction('approve');

export const addExtraView = (id: string, description: string) =>
  api<unknown>(`/design/sessions/${id}/views`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  });

export const lockProduct = (id: string) =>
  api<unknown>(`/design/sessions/${id}/lock`, { method: 'POST' });

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
const PDF_TYPE = 'application/pdf';

type UploadPurpose = 'REFERENCE' | 'CHAT' | 'FINAL_DESIGN';

/** Uploads straight to storage, then confirms it so the API checks the real file. */
async function upload(file: File, purpose: UploadPurpose) {
  const ticket = await api<{
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>('/files/upload-url', {
    method: 'POST',
    body: JSON.stringify({ mimeType: file.type, size: file.size, purpose }),
  });

  const stored = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: file,
  }).catch(() => null);
  if (!stored?.ok) throw new ApiError('Không tải được tệp lên kho lưu trữ. Hãy thử lại.');

  await api<void>(`/files/${ticket.fileId}/complete`, { method: 'POST' }).catch((error) => {
    if (error instanceof ApiError && error.status === 400) {
      throw new ApiError('Nội dung tệp không đúng với loại tệp. Hãy chọn tệp khác.');
    }
    throw error;
  });
  return ticket.fileId;
}

function checkImage(file: File) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new ApiError('Chỉ nhận ảnh PNG hoặc JPG. Hãy chọn tệp khác.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError('Ảnh lớn hơn 10 MB. Hãy chọn ảnh nhỏ hơn.');
  }
}

/** Uploads an image, then returns a link to view it. */
export async function uploadImage(file: File) {
  checkImage(file);
  const fileId = await upload(file, 'REFERENCE');
  return { fileId, url: await getImageUrl(fileId) };
}

export async function uploadChatImage(file: File, purpose: 'CHAT' | 'FINAL_DESIGN') {
  checkImage(file);
  return upload(file, purpose);
}

export async function uploadChatFile(file: File) {
  if (![...IMAGE_TYPES, PDF_TYPE].includes(file.type)) {
    throw new ApiError('Chỉ gửi được tệp PNG, JPG hoặc PDF. Hãy chọn tệp khác.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError('Tệp lớn hơn 10 MB. Hãy chọn tệp nhỏ hơn.');
  }
  return upload(file, 'CHAT');
}
