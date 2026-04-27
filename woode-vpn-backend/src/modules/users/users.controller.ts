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
  @ApiOperation({ summary: 'Register user or return existing user' })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ description: 'User registered successfully' })
  @ApiBadRequestResponse({ description: 'Validation error in request body' })
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
