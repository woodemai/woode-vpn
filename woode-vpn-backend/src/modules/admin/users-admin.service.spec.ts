import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { AdminUsersService } from './users-admin.service';

describe('AdminUsersService', () => {
    const createSubscriptionServiceMock = () => ({
        getActiveSubscriptionWhere: jest.fn(() => ({
            status: SubscriptionStatus.ACTIVE,
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
        })),
        getActiveSubscriptionOrderBy: jest
            .fn()
            .mockReturnValue([{ endsAt: 'desc' }, { id: 'desc' }]),
    });

    const createPrismaMock = () => ({
        user: {
            findMany: jest.fn(),
            count: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        vpnProfile: {
            updateMany: jest.fn(),
        },
        $transaction: jest.fn(),
    });

    it('list should include dynamic active subscription query and map activeSubscription', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findMany.mockResolvedValue([
            {
                id: 1,
                externalId: '123',
                telegramName: 'alice',
                isBlocked: false,
                createdAt: new Date(),
                subscriptions: [{ id: 99, status: SubscriptionStatus.ACTIVE }],
            },
        ]);
        prisma.user.count.mockResolvedValue(1);

        const result = await service.list({ page: 1, perPage: 25, q: 'alice' });

        expect(prisma.user.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                include: {
                    subscriptions: {
                        where: {
                            status: SubscriptionStatus.ACTIVE,
                            startsAt: { lte: expect.any(Date) },
                            endsAt: { gt: expect.any(Date) },
                        },
                        orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
                        take: 1,
                    },
                },
            }),
        );
        expect(result.items).toHaveLength(1);
        expect(result.items[0].activeSubscription).toEqual(
            expect.objectContaining({ id: 99 }),
        );
    });

    it('get should include dynamic active subscription and return null when absent', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue({
            id: 7,
            externalId: '777',
            telegramName: null,
            isBlocked: false,
            createdAt: new Date(),
            subscriptions: [],
        });

        const result = await service.get(7);

        expect(prisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                include: {
                    subscriptions: {
                        where: {
                            status: SubscriptionStatus.ACTIVE,
                            startsAt: { lte: expect.any(Date) },
                            endsAt: { gt: expect.any(Date) },
                        },
                        orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
                        take: 1,
                    },
                },
            }),
        );
        expect(result.activeSubscription).toBeNull();
    });

    it('block should throw when user does not exist', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.block(10)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('block should throw when user already blocked', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue({ id: 10, isBlocked: true });

        await expect(service.block(10)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('block should set isBlocked and disable vpn profiles', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue({ id: 11, isBlocked: false });
        prisma.user.update.mockResolvedValue({ id: 11, isBlocked: true });
        prisma.vpnProfile.updateMany.mockResolvedValue({ count: 1 });
        prisma.$transaction.mockResolvedValue([]);

        const result = await service.block(11);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: 11 },
            data: { isBlocked: true },
        });
        expect(prisma.vpnProfile.updateMany).toHaveBeenCalledWith({
            where: { userId: 11 },
            data: { active: false },
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true });
    });

    it('unblock should throw when user does not exist', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.unblock(20)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('unblock should throw when user is not blocked', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue({ id: 20, isBlocked: false });

        await expect(service.unblock(20)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('unblock should clear isBlocked', async () => {
        const prisma = createPrismaMock();
        const subscriptionService = createSubscriptionServiceMock();
        const service = new AdminUsersService(
            prisma as any,
            subscriptionService as any,
        );

        prisma.user.findUnique.mockResolvedValue({ id: 21, isBlocked: true });
        prisma.user.update.mockResolvedValue({ id: 21, isBlocked: false });

        const result = await service.unblock(21);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: 21 },
            data: { isBlocked: false },
        });
        expect(result).toEqual({ success: true });
    });
});
