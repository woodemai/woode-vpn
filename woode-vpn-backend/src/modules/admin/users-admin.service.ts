import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { SubscriptionService } from '../../services/subscription.service';
import { AdminUserListDto } from './dto/admin-user-list.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminUsersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly subscriptionService: SubscriptionService,
    ) { }

    async list(query: AdminUserListDto) {
        const page = query.page ?? 1;
        const perPage = query.perPage ?? 25;
        const now = new Date();
        const where: any = {};
        if (query.q) {
            where.OR = [
                { externalId: { contains: query.q, mode: 'insensitive' } },
                { telegramName: { contains: query.q, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip: (page - 1) * perPage,
                take: perPage,
                orderBy: { createdAt: 'desc' },
                include: {
                    subscriptions: {
                        where: this.subscriptionService.getActiveSubscriptionWhere(
                            undefined,
                            now,
                        ),
                        orderBy: this.subscriptionService.getActiveSubscriptionOrderBy(),
                        take: 1,
                    },
                },
            }),
            this.prisma.user.count({ where }),
        ]);

        return {
            items: items.map(user => ({
                ...user,
                activeSubscription: user.subscriptions[0] ?? null,
            })),
            total,
            page,
            perPage,
        };
    }

    async get(id: number) {
        const now = new Date();
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: {
                subscriptions: {
                    where: this.subscriptionService.getActiveSubscriptionWhere(id, now),
                    orderBy: this.subscriptionService.getActiveSubscriptionOrderBy(),
                    take: 1,
                },
            },
        });
        if (!user) throw new NotFoundException('User not found');
        return {
            ...user,
            activeSubscription: user.subscriptions[0] ?? null,
        };
    }

    async update(id: number, dto: UpdateUserDto) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException('User not found');
        return this.prisma.user.update({ where: { id }, data: dto as any });
    }

    async block(id: number) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException('User not found');
        if (user.isBlocked)
            throw new BadRequestException('User already blocked');

        // disable vpn access and mark blocked
        await this.prisma.$transaction([
            this.prisma.user.update({ where: { id }, data: { isBlocked: true } }),
            this.prisma.vpnProfile.updateMany({
                where: { userId: id },
                data: { active: false },
            }),
        ]);

        // TODO: invalidate tokens (if stored) — implementation depends on token storage

        return { success: true };
    }

    async unblock(id: number) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.isBlocked)
            throw new BadRequestException('User is not blocked');

        await this.prisma.user.update({
            where: { id },
            data: { isBlocked: false },
        });
        return { success: true };
    }
}
