#!/usr/bin/env bash
set -euo pipefail
: "${JAVA:=java}"
: "${TLC_JAR:?Point TLC_JAR at the official tla2tools.jar}"
cd "$(dirname "$0")"
mkdir -p results
failures=0
printf 'configuration\texpected_exit\tactual_exit\tresult\n' > results/checks.tsv
for variant in TapCart NoAvailability NoOwner NoProtection NoRebinding NoChargeIdempotency NoVersion NoFinalBinding; do
  name="$variant"
  expected_status=0
  expected_message='Model checking completed. No error has been found.'
  case "$variant" in
    TapCart) name=correct ;;
    NoAvailability) expected_status=13; expected_message='Error: Action property ReservationExclusivity is violated.' ;;
    NoOwner) expected_status=13; expected_message='Error: Action property OwnerRelease is violated.' ;;
    NoProtection|NoRebinding) expected_status=13; expected_message='Error: Action property ProtectionIntegrity is violated.' ;;
    NoChargeIdempotency) expected_status=12; expected_message='Error: Invariant SingleCharge is violated.' ;;
  esac
  set +e
  "$JAVA" -XX:+UseParallelGC -cp "$TLC_JAR" tlc2.TLC -workers 2 -config "$variant.cfg" -metadir "${TMPDIR:-/tmp}/tapcart-tlc-$variant" TapCart.tla > "results/$name.txt" 2>&1
  result=$?
  set -e
  verdict=PASS
  if [ "$result" -ne "$expected_status" ] || ! grep -Fq "$expected_message" "results/$name.txt"; then
    verdict=FAIL
  elif [ "$expected_status" -eq 0 ] && ! grep -Fq '0 states left on queue.' "results/$name.txt"; then
    verdict=FAIL
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$expected_status" "$result" "$verdict" >> results/checks.tsv
  echo "$name expected=$expected_status actual=$result $verdict"
  if [ "$verdict" = FAIL ]; then
    failures=$((failures + 1))
    echo "Unexpected TLC result for $name; inspect results/$name.txt" >&2
  fi
done
shasum -a 256 TapCart.tla *.cfg run.sh "$TLC_JAR" > results/SHA256SUMS
if [ "$failures" -ne 0 ]; then
  echo "$failures unexpected TLC result(s)." >&2
  exit 1
fi
