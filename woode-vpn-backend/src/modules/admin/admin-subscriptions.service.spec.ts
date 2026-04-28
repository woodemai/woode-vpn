import { SubscriptionStatus } from '@prisma/client';

jest.mock('../vpn/vpn.service', () => ({
    VpnService: class VpnService { },
}));

import { AdminSubscriptionsService } from './admin-subscriptions.service';

describe('AdminSubscriptionsService', () => {
    it('cancelLastSubscription should use dynamic active-subscription window in queries', async () => {
        const now = new Date();
        const prisma = {
            subscription: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
            },
        };
        const vpnService = {
            disableUserProfile: jest.fn(),
        };
        const subscriptionService = {
            getActiveSubscriptionWhere: jest.fn(() => ({
                userId: 8,
                status: SubscriptionStatus.ACTIVE,
                startsAt: { lte: now },
                endsAt: { gt: now },
            })),
            getNextActiveSubscriptionWhere: jest.fn(() => ({
                userId: 8,
                status: SubscriptionStatus.ACTIVE,
                startsAt: { gte: now },
                endsAt: { gt: now },
            })),
            getActiveSubscriptionOrderBy: jest
                .fn()
                .mockReturnValue([{ endsAt: 'desc' }, { id: 'desc' }]),
        };
        const telegramNotifierService = {
            sendToChat: jest.fn(),
        };

        const service = new AdminSubscriptionsService(
            prisma as any,
            subscriptionService as any,
            vpnService as any,
            telegramNotifierService as any,
        );

        prisma.subscription.findUnique.mockResolvedValue({
            id: 50,
            userId: 8,
            status: SubscriptionStatus.ACTIVE,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 60_000),
            user: { externalId: null },
        });

        prisma.subscription.findFirst
            .mockResolvedValueOnce({
                id: 50,
                userId: 8,
                status: SubscriptionStatus.ACTIVE,
            })
            .mockResolvedValueOnce(null);

        prisma.subscription.update.mockResolvedValue({
            id: 50,
            userId: 8,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 60_000),
        });

        await service.cancelLastSubscription(50);

        expect(prisma.subscription.findFirst).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: {
                    userId: 8,
                    status: SubscriptionStatus.ACTIVE,
                },
            }),
        );

        expect(prisma.subscription.findFirst).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: {
                    userId: 8,
                    status: SubscriptionStatus.ACTIVE,
                    startsAt: { gte: expect.any(Date) },
                    endsAt: { gt: expect.any(Date) },
                },
            }),
        );

        expect(
            subscriptionService.getNextActiveSubscriptionWhere,
        ).toHaveBeenCalledTimes(1);
        expect(vpnService.disableUserProfile).toHaveBeenCalledWith(8);
    });
});
