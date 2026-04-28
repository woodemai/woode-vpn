import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  @ApiOperation({
    summary: 'Health check endpoint',
    description:
      'Verify API service is running and responding. Returns service status and version information.',
  })
  @ApiOkResponse({
    description: 'Service is healthy',
    example: { status: 'ok', version: '0.0.1' },
  })
  getHealth() {
    return this.appService.getHealth();
  }
}
