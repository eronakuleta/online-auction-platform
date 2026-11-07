import type { RequestHandler } from 'express';
import type { Settlement } from '../repositories/settlement.repository';
import { listPaymentsQuerySchema } from '../schemas/wallet.schemas';
import type { SettlementService } from '../services/settlement.service';

function toSettlementResponse(settlement: Settlement) {
  return {
    id: settlement.id,
    auctionId: settlement.auctionId,
    winnerId: settlement.winnerId,
    sellerId: settlement.sellerId,
    amountCents: settlement.amountCents,
    currency: settlement.currency,
    status: settlement.status,
    feeCents: settlement.feeCents,
    sellerCents: settlement.sellerCents,
    failureReason: settlement.failureReason,
    createdAt: settlement.createdAt.toISOString(),
  };
}

export function createSettlementController(settlementService: SettlementService) {
  const list: RequestHandler = async (req, res) => {
    const { settlements, ...pagination } = await settlementService.list(
      listPaymentsQuerySchema.parse(req.query),
    );
    res.status(200).json({ data: settlements.map(toSettlementResponse), ...pagination });
  };

  return { list };
}
