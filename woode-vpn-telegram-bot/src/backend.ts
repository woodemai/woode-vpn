export interface RegisterUserResponse {
  userId: number;
  externalId?: string;
  telegramName?: string;
  email?: string;
  createdAt: string;
}

export interface ConfirmPaymentResponse {
  userId: number;
  endsAt: string;
  subscriptionUrl: string;
  subscriptionText?: string;
  alreadyProcessed: boolean;
}

export interface CreatePaymentResponse {
  userId: number;
  days: number;
  deviceLimit: number;
  amountCents: number;
  paymentId: string;
  paymentUrl: string;
}

export interface UserProfileResponse {
  hasActiveSubscription: boolean;
  subscriptionUrl?: string;
  endsAt?: string;
  profileName?: string;
  devicesConnected?: number;
  devicesMax?: number;
  trafficUsedBytes?: number;
  trafficTotalBytes?: number | null;
}

interface BackendClientOptions {
  baseUrl: string;
  requestTimeoutMs?: number;
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
  }

  async registerUser(input: {
    telegramUserId: number;
    telegramName: string;
  }): Promise<RegisterUserResponse> {
    const displayName = this.buildTelegramDisplayName(input.telegramName);

    return this.request<RegisterUserResponse>('/api/users/register', {
      method: 'POST',
      body: { externalId: String(input.telegramUserId), telegramName: displayName },
    });
  }

  private buildTelegramDisplayName(telegramName: string): string {
    return telegramName.trim().slice(0, 128) || 'Telegram user';
  }

  async confirmPayment(input: {
    userId: number;
    days: number;
    deviceLimit?: number;
    amountCents?: number;
  }): Promise<ConfirmPaymentResponse> {
    return this.request<ConfirmPaymentResponse>('/api/payments/confirm', {
      method: 'POST',
      body: input,
    });
  }

  async createPayment(input: {
    userId: number;
    days: number;
    deviceLimit: number;
    amountCents: number;
    returnUrl?: string;
  }): Promise<CreatePaymentResponse> {
    return this.request<CreatePaymentResponse>('/api/payments/create', {
      method: 'POST',
      body: input,
    });
  }

  async getProfile(userId: number): Promise<UserProfileResponse> {
    return this.request<UserProfileResponse>(`/api/vpn/users/${userId}/profile`, {
      method: 'GET',
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
    },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new Error(`Backend request timeout or network error: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Backend request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }
}
