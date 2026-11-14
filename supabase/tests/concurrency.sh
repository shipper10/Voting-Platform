#!/usr/bin/env bash
# 12 طلباً متزامناً بنفس الرقم الجامعي ⇒ مشاركة واحدة وورقة واحدة. ثم الإغلاق بوقت الخادم.
set -euo pipefail
E=$(psql -Atc "select v from t.ctx where k='conc_e'"); S=$(psql -Atc "select v from t.ctx where k='conc_s'"); C=$(psql -Atc "select v from t.ctx where k='conc_c'")
Q="select set_config('request.jwt.claim.sub','',false); set role service_role; select cast_ballot('$E','S8','conc-key-'||pg_backend_pid()||'-xxxxxxxx', jsonb_build_array(jsonb_build_object('section_id','$S','selections',jsonb_build_array(jsonb_build_object('candidate_id','$C')))))->>'status';"
for i in $(seq 1 12); do (psql -Atq -c "$Q" | tail -1 >> "$(dirname "$0")/.conc.out") & done
wait
OK=$(grep -c '^ok$' "$(dirname "$0")/.conc.out" || true); rm -f "$(dirname "$0")/.conc.out"
P=$(psql -Atc "select count(*) from voter_participation where election_id='$E'"); H=$(psql -Atc "select count(*) from ballot_sheets where election_id='$E'")
echo "متزامن: ok=$OK participation=$P sheets=$H"
[ "$OK" = 1 ] && [ "$P" = 1 ] && [ "$H" = 1 ] || { echo "فشل اختبار التزامن"; exit 1; }
# الإغلاق: ننتظر انتهاء ends_at (وقت الخادم) ثم نحاول
psql -Atq -c "select pg_sleep(greatest(0, extract(epoch from (ends_at - clock_timestamp())) + 1)) from elections where id='$E'" >/dev/null
R=$(psql -Atq -c "select set_config('request.jwt.claim.sub','',false); set role service_role; select cast_ballot('$E','S9','late-key-xxxxxxxxxxxx', jsonb_build_array(jsonb_build_object('section_id','$S','selections',jsonb_build_array(jsonb_build_object('candidate_id','$C')))))->>'status';" | tail -1)
[ "$R" = closed ] || { echo "كان يجب رفض الصوت المتأخر: $R"; exit 1; }
echo "الإغلاق بوقت الخادم: OK"
