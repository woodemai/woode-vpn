import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiSecurity,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminUserListDto } from './dto/admin-user-list.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';
import { AdminUsersService } from './users-admin.service';

@ApiTags('Admin')
@ApiSecurity('x-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/users')
export class UsersAdminController {
    constructor(private readonly usersService: AdminUsersService) { }

    @Get()
    @ApiOperation({
        summary: 'List all users with pagination and search',
        description:
            'Retrieve paginated list of users with optional search by telegram name or external ID and their current active subscriptions.',
    })
    @ApiQuery({
        name: 'page',
        required: false,
        type: Number,
        description: 'Page number (default: 1)',
        example: 1,
    })
    @ApiQuery({
        name: 'perPage',
        required: false,
        type: Number,
        description: 'Items per page (default: 25)',
        example: 25,
    })
    @ApiQuery({
        name: 'q',
        required: false,
        type: String,
        description: 'Search query by telegram name or external ID',
        example: 'user123',
    })
    @ApiOkResponse({ description: 'Users list returned successfully' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
    async list(@Query() q: AdminUserListDto) {
        return this.usersService.list(q);
    }

    @Get(':id')
    @ApiOperation({
        summary: 'Get user details by ID',
        description:
            'Retrieve detailed information about a specific user including active subscription data.',
    })
    @ApiParam({
        name: 'id',
        type: Number,
        description: 'User ID',
        example: 1,
    })
    @ApiOkResponse({ description: 'User details returned successfully' })
    @ApiNotFoundResponse({ description: 'User not found' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
    async get(@Param('id', ParseIntPipe) id: number) {
        return this.usersService.get(id);
    }

    @Patch(':id')
    @ApiOperation({
        summary: 'Update user information',
        description: 'Update user profile data such as telegram name.',
    })
    @ApiParam({
        name: 'id',
        type: Number,
        description: 'User ID',
        example: 1,
    })
    @ApiBody({ type: UpdateUserDto })
    @ApiOkResponse({ description: 'User updated successfully' })
    @ApiBadRequestResponse({ description: 'Validation error in request body' })
    @ApiNotFoundResponse({ description: 'User not found' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateUserDto,
    ) {
        return this.usersService.update(id, dto);
    }

    @Post(':id/block')
    @ApiOperation({
        summary: 'Block user access',
        description:
            'Block user account by marking as blocked and disabling all VPN profiles. User cannot access VPN until unblocked.',
    })
    @ApiParam({
        name: 'id',
        type: Number,
        description: 'User ID to block',
        example: 1,
    })
    @ApiOkResponse({
        description: 'User blocked successfully',
        schema: { example: { success: true } },
    })
    @ApiBadRequestResponse({
        description: 'User already blocked or other validation error',
    })
    @ApiNotFoundResponse({ description: 'User not found' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
    async block(@Param('id', ParseIntPipe) id: number) {
        return this.usersService.block(id);
    }

    @Post(':id/unblock')
    @ApiOperation({
        summary: 'Unblock user access',
        description:
            'Restore user account access by removing block status. User can access VPN again.',
    })
    @ApiParam({
        name: 'id',
        type: Number,
        description: 'User ID to unblock',
        example: 1,
    })
    @ApiOkResponse({
        description: 'User unblocked successfully',
        schema: { example: { success: true } },
    })
    @ApiBadRequestResponse({
        description: 'User is not blocked or other validation error',
    })
    @ApiNotFoundResponse({ description: 'User not found' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
    async unblock(@Param('id', ParseIntPipe) id: number) {
        return this.usersService.unblock(id);
    }
}
