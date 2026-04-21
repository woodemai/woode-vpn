import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrGet(input: CreateUserDto): Promise<User> {
    if (input.externalId) {
      const existing = await this.prisma.user.findUnique({
        where: { externalId: input.externalId },
      });
      if (existing) {
        return existing;
      }
    }

    if (input.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        return existing;
      }
    }

    return this.prisma.user.create({
      data: {
        externalId: input.externalId,
        email: input.email,
      },
    });
  }

  async getById(userId: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}
