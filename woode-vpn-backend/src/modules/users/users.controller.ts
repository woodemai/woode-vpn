import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Post('register')
  @ApiOperation({
    summary: 'Register user or return existing user',
    description:
      'Register a new user or retrieve existing user by external ID. Idempotent - calling multiple times with same externalId returns same user. Used for Telegram bot user onboarding.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({
    description: 'User registered or retrieved successfully',
    example: {
      userId: 1,
      externalId: '123456789',
      telegramName: 'woodemai',
      createdAt: '2026-04-28T11:35:10.000Z',
    },
  })
  @ApiBadRequestResponse({
    description:
      'Validation error in request body (invalid externalId or telegramName format)',
  })
  async register(@Body() dto: CreateUserDto) {
    const user = await this.usersService.createOrGet(dto);

    return {
      userId: user.id,
      externalId: user.externalId,
      telegramName: user.telegramName,
      createdAt: user.createdAt,
    };
  }
}
