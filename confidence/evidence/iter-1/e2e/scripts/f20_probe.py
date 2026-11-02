import sys, time, json
sys.argv = [sys.argv[0]]
exec(open("http_checks.py").read().split('if __name__ == "__main__":')[0])
t = f"e2e1-f20probe-{RUN}"
for attempt in range(3):
    tt = f"{t}-{attempt}"
    st, h, first = publish(A, tt, title="first")
    s = SSE(A, f"/v1/feed/stream?tenantId={tt}")
    s.wait_open(); time.sleep(1.2)
    frames = [(f.get("event"), f.get("id"), comm_of(f).get("title", "").split()[-1], f.get("t")) for f in s.frames]
    print(f"attempt {attempt}: 201 at seq? version={first.get('version')} id={first['id'][:8]}; frames after open: {frames}")
    s.close()
    # full replay from 0 shows the event log with seqs
    r = SSE(A, f"/v1/feed/stream?tenantId={tt}&lastEventId=0"); r.wait_open(); time.sleep(1.0)
    print("   replay from 0:", [(f.get("event"), f.get("id"), comm_of(f).get("title", "").split()[-1]) for f in r.frames]); r.close()
    # now the F-20 sequence with the snapshot id as Last-Event-ID
    last_id = frames[0][1]
    req(A, "POST", f"/v1/communications/{first['id']}/retire", {"note": "gone"})
    st, h, second = publish(A, tt, title="second")
    time.sleep(0.8)
    r = SSE(A, f"/v1/feed/stream?tenantId={tt}", headers={"Last-Event-ID": str(last_id)}); r.wait_open(); time.sleep(1.2)
    print(f"   resume with Last-Event-ID={last_id}:", [(f.get("event"), f.get("id"), comm_of(f).get("title", "").split()[-1]) for f in r.frames]); r.close()
    req(A, "POST", f"/v1/communications/{second['id']}/retire", {"note": "cleanup"})
