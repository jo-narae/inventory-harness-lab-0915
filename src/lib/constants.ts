/**
 * 상태값 상수 — SQLite + Prisma 조합에서는 문자열로 저장되므로
 * DB가 오타를 막아주지 않는다. 여기서 as const + 파생 타입으로 1차 방어한다.
 */

// ───────── 거점 유형
export const LOCATION_TYPES = {
  OWN: 'OWN', // 자사창고
  FULFILLMENT: 'FULFILLMENT', // 풀필먼트사
  POPUP: 'POPUP', // 오프라인 팝업 (임시)
  TRANSIT: 'TRANSIT', // 배송 중 (가상)
  DISPOSAL: 'DISPOSAL', // 폐기 (가상)
} as const
export type LocationType = (typeof LOCATION_TYPES)[keyof typeof LOCATION_TYPES]

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  OWN: '자사창고',
  FULFILLMENT: '풀필먼트',
  POPUP: '팝업',
  TRANSIT: '배송 중',
  DISPOSAL: '폐기',
}

/** 즉시 출고 가능 — 현장에서 바로 내보낼 수 있는 거점 유형 */
export const READY_TO_SHIP_LOCATION_TYPES: LocationType[] = [LOCATION_TYPES.OWN]

/** 가용 재고에 포함되는 거점 유형 — 풀필먼트는 발주서를 보내면 출고된다 */
export const AVAILABLE_LOCATION_TYPES: LocationType[] = [
  LOCATION_TYPES.OWN,
  LOCATION_TYPES.FULFILLMENT,
]

/** 전체 재고(회사가 보유한 재고)에 포함되는 거점 유형 — 팝업 반출분은 출고엔 못 써도 보유분이다 */
export const HELD_LOCATION_TYPES: LocationType[] = [
  LOCATION_TYPES.OWN,
  LOCATION_TYPES.FULFILLMENT,
  LOCATION_TYPES.POPUP,
]

// ───────── 이동 유형
export const MOVEMENT_TYPES = {
  INBOUND: 'INBOUND', // 외부 → 내부
  OUTBOUND: 'OUTBOUND', // 내부 → 외부
  TRANSFER: 'TRANSFER', // 내부 → 내부 (발송·도착)
  POPUP_OUT: 'POPUP_OUT', // 팝업 반출 / 팝업에서 판매
  POPUP_IN: 'POPUP_IN', // 팝업 잔여 복귀
  ADJUST: 'ADJUST', // 실사·수치 반영
  DISPOSE: 'DISPOSE', // 폐기
} as const
export type MovementType = (typeof MOVEMENT_TYPES)[keyof typeof MOVEMENT_TYPES]

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  INBOUND: '입고',
  OUTBOUND: '출고',
  TRANSFER: '이동',
  POPUP_OUT: '팝업 반출',
  POPUP_IN: '팝업 복귀',
  ADJUST: '조정',
  DISPOSE: '폐기',
}

// ───────── 증감 사유 (F5-1)
export const REASON_CODES = {
  // 감소
  SALE: 'SALE',
  SAMPLE: 'SAMPLE',
  DAMAGE: 'DAMAGE',
  LOSS: 'LOSS',
  DISPOSE: 'DISPOSE',
  // 증가
  PURCHASE: 'PURCHASE',
  RETURN: 'RETURN',
  // 조정 전용
  COUNT_DIFF: 'COUNT_DIFF',
  INPUT_ERROR: 'INPUT_ERROR',
  // 공통
  OTHER: 'OTHER',
} as const
export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES]

export const REASON_LABEL: Record<ReasonCode, string> = {
  SALE: '판매',
  SAMPLE: '시식·증정',
  DAMAGE: '파손',
  LOSS: '분실',
  DISPOSE: '폐기',
  PURCHASE: '입고',
  RETURN: '반품 재입고',
  COUNT_DIFF: '대조 차이',
  INPUT_ERROR: '오입력 정정',
  OTHER: '기타',
}

/** 화면별 선택 가능한 사유 (첫 항목이 기본값) */
export const OUTBOUND_REASONS: ReasonCode[] = ['SALE', 'SAMPLE', 'DAMAGE', 'LOSS', 'OTHER']
export const INBOUND_REASONS: ReasonCode[] = ['PURCHASE', 'RETURN', 'OTHER']
export const ADJUST_REASONS: ReasonCode[] = ['COUNT_DIFF', 'DAMAGE', 'LOSS', 'INPUT_ERROR', 'OTHER']
/** 메모 없이 저장할 수 없는 사유 */
export const REASON_REQUIRES_NOTE: ReasonCode[] = ['OTHER']

// ───────── 상태값
export const TRANSFER_STATUS = {
  SENT: 'SENT',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const
export type TransferStatus = (typeof TRANSFER_STATUS)[keyof typeof TRANSFER_STATUS]

export const POPUP_STATUS = {
  PREP: 'PREP', // 반출서 작성 중 (재고 안 움직임)
  ACTIVE: 'ACTIVE', // 반출 완료, 행사 진행 중
  SETTLING: 'SETTLING', // 정산 입력 중
  CLOSED: 'CLOSED', // 정산 확정
} as const
export type PopupStatus = (typeof POPUP_STATUS)[keyof typeof POPUP_STATUS]

export const POPUP_STATUS_LABEL: Record<PopupStatus, string> = {
  PREP: '준비',
  ACTIVE: '진행 중',
  SETTLING: '정산 중',
  CLOSED: '종료',
}

export const USER_ROLES = { MEMBER: 'MEMBER', ADMIN: 'ADMIN' } as const
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES]

// ───────── 운영 기준값
/** 배송 중 며칠부터 지연으로 볼 것인가 (3~5일은 정상) */
export const TRANSIT_DELAY_DAYS = 7
/** 상품별 설정이 없을 때의 유통기한 경고 기준일 */
export const DEFAULT_EXPIRY_ALERT_DAYS = 60
