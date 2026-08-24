import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GetUserByTokenRequest {
  @ApiProperty({
    description: "JWT dell'utente.",
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString({ message: 'Il token deve essere una stringa.' })
  token: string;
}
