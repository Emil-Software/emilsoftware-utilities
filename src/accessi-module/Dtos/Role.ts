import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AbilitazioneMenu } from './AbilitazioneMenu';
import { RuoliMenu } from './RuoliMenu';

export class Role {
    @ApiPropertyOptional({ description: 'Codice univoco del ruolo', required: false, type: Number, example: 1 })
    codiceRuolo?: number;

    @ApiProperty({ description: 'Descrizione del ruolo' })
    descrizioneRuolo: string;


    @ApiProperty({
        description: 'Lista di menù associati al ruolo',
        type: [RuoliMenu]
    })
    menu: RuoliMenu[];
}

