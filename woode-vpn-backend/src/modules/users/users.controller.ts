import { Body, Controller, Post } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  async register(@Body() dto: CreateUserDto) {
    const user = await this.usersService.createOrGet(dto);

    return {
      userId: user.id,
      externalId: user.externalId,
      email: user.email,
      createdAt: user.createdAt,
    };
  }
}
