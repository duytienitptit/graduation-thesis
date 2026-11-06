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
    throw new ApiError(`Máy chủ từ chối yêu cầu (mã ${res.status}).`, res.status, body?.errors);
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

export interface DesignSession {
  id: string;
  status: 'ANSWERING' | 'ANSWERED';
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

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg'];

/** Uploads straight to storage, then returns a link to view the image. */
export async function uploadImage(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ApiError('Chỉ nhận ảnh PNG hoặc JPG. Hãy chọn tệp khác.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError('Ảnh lớn hơn 10 MB. Hãy chọn ảnh nhỏ hơn.');
  }

  const ticket = await api<{
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>('/files/upload-url', {
    method: 'POST',
    body: JSON.stringify({ mimeType: file.type, size: file.size, purpose: 'REFERENCE' }),
  });

  const stored = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: file,
  }).catch(() => null);
  if (!stored?.ok) throw new ApiError('Không tải được ảnh lên kho lưu trữ. Hãy thử lại.');

  await api<void>(`/files/${ticket.fileId}/complete`, { method: 'POST' }).catch((error) => {
    if (error instanceof ApiError && error.status === 400) {
      throw new ApiError('Tệp này không phải ảnh PNG hoặc JPG thật. Hãy chọn tệp khác.');
    }
    throw error;
  });

  return { fileId: ticket.fileId, url: await getImageUrl(ticket.fileId) };
}
