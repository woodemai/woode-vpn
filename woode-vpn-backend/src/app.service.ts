import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      service: 'woode-vpn-backend',
      status: 'ok',
      now: new Date().toISOString(),
    };
  }
}
