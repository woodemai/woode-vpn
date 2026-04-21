export interface RegisterUserResponse {
  userId: number;
  externalId?: string;
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

export interface UserProfileResponse {
  hasActiveSubscription: boolean;
  subscriptionUrl?: string;
}

interface BackendClientOptions {
  baseUrl: string;
}

export class BackendClient {
  private readonly baseUrl: string;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async registerUser(telegramUserId: number): Promise<RegisterUserResponse> {
    return this.request<RegisterUserResponse>('/api/users/register', {
      method: 'POST',
      body: { externalId: String(telegramUserId) },
    });
  }

  async confirmPayment(input: {
    userId: number;
    days: number;
  }): Promise<ConfirmPaymentResponse> {
    return this.request<ConfirmPaymentResponse>('/api/payments/confirm', {
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
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Backend request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }
}
