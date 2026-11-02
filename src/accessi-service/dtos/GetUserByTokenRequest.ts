import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetUserByTokenRequest {
  @ApiPropertyOptional({
    description: "JWT dell'utente. In modalita cookie puo essere omesso: si usa il cookie httpOnly o l'header Authorization.",
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString({ message: 'Il token deve essere una stringa.' })
  token?: string;
}
