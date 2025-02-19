(use-trait ft-trait .sip-010-trait-ft-standard.sip-010-trait)
(use-trait swap-token .arkadiko-swap-trait-v1.swap-trait)

(define-constant ERR-NOT-AUTHORIZED u20401)
(define-constant INVALID-PAIR-ERR (err u201))
(define-constant ERR-INVALID-LIQUIDITY u202)

(define-constant no-liquidity-err (err u61))
;; (define-constant transfer-failed-err (err u62))
(define-constant not-owner-err (err u63))
(define-constant no-fee-to-address-err (err u64))
(define-constant no-such-position-err (err u66))
(define-constant balance-too-low-err (err u67))
(define-constant too-many-pairs-err (err u68))
(define-constant pair-already-exists-err (err u69))
(define-constant wrong-token-err (err u70))
(define-constant too-much-slippage-err (err u71))
(define-constant transfer-x-failed-err (err u72))
(define-constant transfer-y-failed-err (err u73))
(define-constant value-out-of-range-err (err u74))
(define-constant no-fee-x-err (err u75))
(define-constant no-fee-y-err (err u76))

(define-map pairs-map
  { pair-id: uint }
  {
    token-x: principal,
    token-y: principal,
  }
)

(define-map pairs-data-map
  {
    token-x: principal,
    token-y: principal,
  }
  {
    shares-total: uint,
    balance-x: uint,
    balance-y: uint,
    fee-balance-x: uint,
    fee-balance-y: uint,
    fee-to-address: principal,
    swap-token: principal,
    name: (string-ascii 32),
  }
)

(define-data-var pair-count uint u0)
(define-data-var pairs-list (list 2000 uint) (list ))

(define-read-only (get-name (token-x-trait <ft-trait>) (token-y-trait <ft-trait>))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR)))
    )
    (ok (get name pair))
  )
)

(define-public (get-symbol (token-x-trait <ft-trait>) (token-y-trait <ft-trait>))
  (ok
    (concat
      (unwrap-panic (as-max-len? (unwrap-panic (contract-call? token-x-trait get-symbol)) u15))
      (concat "-"
        (unwrap-panic (as-max-len? (unwrap-panic (contract-call? token-y-trait get-symbol)) u15))
      )
    )
  )
)

(define-read-only (get-total-supply (token-x-trait <ft-trait>) (token-y-trait <ft-trait>))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR)))
    )
    (ok (get shares-total pair))
  )
)

;; get the total number of shares in the pool
(define-read-only (get-shares (token-x principal) (token-y principal))
  (ok (get shares-total (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR))))
)

;; get overall balances for the pair
(define-public (get-balances (token-x-trait <ft-trait>) (token-y-trait <ft-trait>))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR)))
    )
    (ok (list (get balance-x pair) (get balance-y pair)))
  )
)

(define-public (get-data (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (swap-token-trait <swap-token>) (owner principal))
  (let
    (
      (token-data (unwrap-panic (contract-call? swap-token-trait get-data owner)))
      (balances (unwrap-panic (get-balances token-x-trait token-y-trait)))
    )
    (ok (merge token-data { balances: balances }))
  )
)

(define-public (add-to-position (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (swap-token-trait <swap-token>) (x uint) (y uint))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
      (contract-address (as-contract tx-sender))
      (recipient-address tx-sender)
      (balance-x (get balance-x pair))
      (balance-y (get balance-y pair))
      (new-shares
        (if (is-eq (get shares-total pair) u0)
          (sqrti (* x y))
          (/ (* x (get shares-total pair)) balance-x)
        )
      )
      (new-y
        (if (is-eq (get shares-total pair) u0)
          y
          (/ (* x balance-y) balance-x)
        )
      )
      (pair-updated (merge pair {
        shares-total: (+ new-shares (get shares-total pair)),
        balance-x: (+ balance-x x),
        balance-y: (+ balance-y new-y)
      }))
    )
    (asserts! (and (> x u0) (> new-y u0)) (err ERR-INVALID-LIQUIDITY))

    (if (is-eq (unwrap-panic (contract-call? token-x-trait get-symbol)) "wSTX")
      (begin
        (try! (contract-call? .arkadiko-dao mint-token .wrapped-stx-token x tx-sender))
        (try! (stx-transfer? x tx-sender (as-contract tx-sender)))
      )
      false
    )
    (if (is-eq (unwrap-panic (contract-call? token-y-trait get-symbol)) "wSTX")
      (begin
        (try! (contract-call? .arkadiko-dao mint-token .wrapped-stx-token y tx-sender))
        (try! (stx-transfer? y tx-sender (as-contract tx-sender)))
      )
      false
    )

    (asserts! (is-ok (contract-call? token-x-trait transfer x tx-sender contract-address none)) transfer-x-failed-err)
    (asserts! (is-ok (contract-call? token-y-trait transfer new-y tx-sender contract-address none)) transfer-y-failed-err)

    (map-set pairs-data-map { token-x: token-x, token-y: token-y } pair-updated)
    (try! (contract-call? swap-token-trait mint recipient-address new-shares))
    (print { object: "pair", action: "liquidity-added", data: pair-updated })
    (ok true)
  )
)

(define-read-only (get-pair-details (token-x principal) (token-y principal))
  (let (
    (pair (map-get? pairs-data-map { token-x: token-x, token-y: token-y }))
  )
    (if (is-some pair)
      (ok pair)
      (err INVALID-PAIR-ERR)
    )
  )
)

(define-read-only (get-pair-contracts (pair-id uint))
  (unwrap-panic (map-get? pairs-map { pair-id: pair-id }))
)

(define-read-only (get-pair-count)
  (ok (var-get pair-count))
)

(define-read-only (get-pairs)
  (ok (map get-pair-contracts (var-get pairs-list)))
)

(define-public (create-pair (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (swap-token-trait <swap-token>) (pair-name (string-ascii 32)) (x uint) (y uint))
  (let
    (
      (name-x (unwrap-panic (contract-call? token-x-trait get-name)))
      (name-y (unwrap-panic (contract-call? token-y-trait get-name)))
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair-id (+ (var-get pair-count) u1))
      (pair-data {
        shares-total: u0,
        balance-x: u0,
        balance-y: u0,
        fee-balance-x: u0,
        fee-balance-y: u0,
        fee-to-address: (contract-call? .arkadiko-dao get-payout-address),
        swap-token: (contract-of swap-token-trait),
        name: pair-name,
      })
    )
    (asserts!
      (and
        (is-none (map-get? pairs-data-map { token-x: token-x, token-y: token-y }))
        (is-none (map-get? pairs-data-map { token-x: token-y, token-y: token-x }))
      )
      pair-already-exists-err
    )

    (map-set pairs-data-map { token-x: token-x, token-y: token-y } pair-data)
    (map-set pairs-map { pair-id: pair-id } { token-x: token-x, token-y: token-y })
    (var-set pairs-list (unwrap! (as-max-len? (append (var-get pairs-list) pair-id) u2000) too-many-pairs-err))
    (var-set pair-count pair-id)
    (try! (add-to-position token-x-trait token-y-trait swap-token-trait x y))
    (print { object: "pair", action: "created", data: pair-data })
    (ok true)
  )
)

;; TODO: can be read-only once bug with traits is fixed
(define-public (get-position (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (swap-token-trait <swap-token>))
    (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
      (balance-x (get balance-x pair))
      (balance-y (get balance-y pair))
      (shares (unwrap-panic (contract-call? swap-token-trait get-balance tx-sender)))
      (shares-total (get shares-total pair))
      (withdrawal-x (/ (* shares balance-x) shares-total))
      (withdrawal-y (/ (* shares balance-y) shares-total))
    )
    (ok (list withdrawal-x withdrawal-y))
  )
)

;; ;; reduce the amount of liquidity the sender provides to the pool
;; ;; to close, use u100
(define-public (reduce-position (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (swap-token-trait <swap-token>) (percent uint))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
      (balance-x (get balance-x pair))
      (balance-y (get balance-y pair))
      (shares (unwrap-panic (contract-call? swap-token-trait get-balance tx-sender)))
      (shares-total (get shares-total pair))
      (contract-address (as-contract tx-sender))
      (sender tx-sender)
      (withdrawal (/ (* shares percent) u100))
      (withdrawal-x (/ (* withdrawal balance-x) shares-total))
      (withdrawal-y (/ (* withdrawal balance-y) shares-total))
      (pair-updated
        (merge pair
          {
            shares-total: (- shares-total withdrawal),
            balance-x: (- (get balance-x pair) withdrawal-x),
            balance-y: (- (get balance-y pair) withdrawal-y)
          }
        )
      )
    )

    (asserts! (<= percent u100) (err u5))
    (asserts! (is-ok (as-contract (contract-call? token-x-trait transfer withdrawal-x contract-address sender none))) transfer-x-failed-err)
    (asserts! (is-ok (as-contract (contract-call? token-y-trait transfer withdrawal-y contract-address sender none))) transfer-y-failed-err)

    (map-set pairs-data-map { token-x: token-x, token-y: token-y } pair-updated)
    (try! (contract-call? swap-token-trait burn tx-sender withdrawal))

    (print { object: "pair", action: "liquidity-removed", data: pair-updated })
    (ok (list withdrawal-x withdrawal-y))
  )
)

;; exchange known dx of x-token for whatever dy of y-token based on current liquidity, returns (dx dy)
;; the swap will not happen if can't get at least min-dy back
(define-public (swap-x-for-y (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (dx uint) (min-dy uint))
  (let (
    (token-x (contract-of token-x-trait))
    (token-y (contract-of token-y-trait))
    (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
    (balance-x (get balance-x pair))
    (balance-y (get balance-y pair))
    (sender tx-sender)
    (dx-with-fees (/ (* u997 dx) u1000)) ;; 0.3% fee for LPs
    (dy (/ (* balance-y dx-with-fees) (+ balance-x dx-with-fees)))
    (fee (/ (* u5 dx) u10000)) ;; 0.05% fee for protocol
    (pair-updated
      (merge pair
        {
          balance-x: (+ balance-x dx),
          balance-y: (- balance-y dy),
          fee-balance-x: (+ fee (get fee-balance-x pair))
        }
      )
    )
  )
    (asserts! (< min-dy dy) too-much-slippage-err)
    ;; if token X is wrapped STX (i.e. the sender needs to exchange STX for wSTX)
    (if (is-eq (unwrap-panic (contract-call? token-x-trait get-symbol)) "wSTX")
      (begin
        (try! (stx-transfer? dx tx-sender (as-contract tx-sender)))
        (try! (contract-call? .arkadiko-dao mint-token .wrapped-stx-token dx tx-sender))
      )
      false
    )

    (asserts! (is-ok (contract-call? token-x-trait transfer dx tx-sender (as-contract tx-sender) none)) transfer-x-failed-err)
    (try! (as-contract (contract-call? token-y-trait transfer dy (as-contract tx-sender) sender none)))

    ;; if token Y is wrapped STX, need to burn it
    (if (is-eq (unwrap-panic (contract-call? token-y-trait get-symbol)) "wSTX")
      (begin
        (try! (contract-call? .arkadiko-dao burn-token .wrapped-stx-token dy tx-sender))
        (try! (as-contract (stx-transfer? dy (as-contract tx-sender) sender)))
      )
      false
    )

    (map-set pairs-data-map { token-x: token-x, token-y: token-y } pair-updated)
    (print { object: "pair", action: "swap-x-for-y", data: pair-updated })
    (ok (list dx dy))
  )
)

;; exchange known dy for whatever dx based on liquidity, returns (dx dy)
;; the swap will not happen if can't get at least min-dx back
(define-public (swap-y-for-x (token-x-trait <ft-trait>) (token-y-trait <ft-trait>) (dy uint) (min-dx uint))
  (let (
    (token-x (contract-of token-x-trait))
    (token-y (contract-of token-y-trait))
    (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
    (balance-x (get balance-x pair))
    (balance-y (get balance-y pair))
    (sender tx-sender)
    (dy-with-fees (/ (* u997 dy) u1000)) ;; 0.3% fee for LPs
    (dx (/ (* balance-x dy-with-fees) (+ balance-y dy-with-fees)))
    (fee (/ (* u5 dy) u10000)) ;; 0.05% fee for protocol
    (pair-updated (merge pair {
      balance-x: (- balance-x dx),
      balance-y: (+ balance-y dy),
      fee-balance-y: (+ fee (get fee-balance-y pair))
    }))
  )
    (asserts! (< min-dx dx) too-much-slippage-err)
    ;; if token Y is wrapped STX (i.e. the sender needs to exchange STX for wSTX)
    (if (is-eq (unwrap-panic (contract-call? token-y-trait get-symbol)) "wSTX")
      (begin
        (try! (contract-call? .arkadiko-dao mint-token .wrapped-stx-token dy tx-sender))
        (try! (stx-transfer? dy tx-sender (as-contract tx-sender)))
      )
      false
    )

    (asserts! (is-ok (as-contract (contract-call? token-x-trait transfer dx (as-contract tx-sender) sender none))) transfer-x-failed-err)
    (asserts! (is-ok (contract-call? token-y-trait transfer dy tx-sender (as-contract tx-sender) none)) transfer-y-failed-err)

    ;; if token X is wrapped STX, need to burn it
    (if (is-eq (unwrap-panic (contract-call? token-x-trait get-symbol)) "wSTX")
      (begin
        (try! (contract-call? .arkadiko-dao burn-token .wrapped-stx-token dx tx-sender))
        (try! (as-contract (stx-transfer? dx (as-contract tx-sender) sender)))
      )
      false
    )

    (map-set pairs-data-map { token-x: token-x, token-y: token-y } pair-updated)
    (print { object: "pair", action: "swap-y-for-x", data: pair-updated })
    (ok (list dx dy))
  )
)

;; activate the contract fee for swaps by setting the collection address, restricted to contract owner
(define-public (set-fee-to-address (token-x principal) (token-y principal) (address principal))
  (let (
    (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
  )
    (asserts! (is-eq tx-sender .arkadiko-dao) (err ERR-NOT-AUTHORIZED))

    (map-set pairs-data-map
      { token-x: token-x, token-y: token-y }
      (merge pair { fee-to-address: address })
    )
    (ok true)
  )
)

;; ;; get the current address used to collect a fee
(define-read-only (get-fee-to-address (token-x principal) (token-y principal))
  (let ((pair (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR))))
    (ok (get fee-to-address pair))
  )
)

;; ;; get the amount of fees charged on x-token and y-token exchanges that have not been collected yet
(define-read-only (get-fees (token-x principal) (token-y principal))
  (let ((pair (unwrap! (map-get? pairs-data-map { token-x: token-x, token-y: token-y }) (err INVALID-PAIR-ERR))))
    (ok (list (get fee-balance-x pair) (get fee-balance-y pair)))
  )
)

;; send the collected fees the fee-to-address
(define-public (collect-fees (token-x-trait <ft-trait>) (token-y-trait <ft-trait>))
  (let
    (
      (token-x (contract-of token-x-trait))
      (token-y (contract-of token-y-trait))
      (pair (unwrap-panic (map-get? pairs-data-map { token-x: token-x, token-y: token-y })))
      (address (get fee-to-address pair))
      (fee-x (get fee-balance-x pair))
      (fee-y (get fee-balance-y pair))
    )

    (asserts! (is-eq fee-x u0) no-fee-x-err)
    (asserts! (is-ok (contract-call? token-x-trait transfer fee-x (as-contract tx-sender) address none)) transfer-x-failed-err)
    (asserts! (is-eq fee-y u0) no-fee-y-err)
    (asserts! (is-ok (contract-call? token-y-trait transfer fee-y (as-contract tx-sender) address none)) transfer-y-failed-err)

    (map-set pairs-data-map
      { token-x: token-x, token-y: token-y }
      (merge pair { fee-balance-x: u0, fee-balance-y: u0 })
    )
    (ok (list fee-x fee-y))
  )
)
