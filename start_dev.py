"""Start dev servers for browser testing."""
import subprocess, time, urllib.request, os, sys, signal

project_root = os.path.dirname(os.path.abspath(__file__))
backend_proc = None
frontend_proc = None

def check_url(url, timeout=3):
    try:
        return urllib.request.urlopen(url, timeout=timeout).getcode()
    except: return None

try:
    # Start backend
    print("Starting backend...")
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api.server:create_app", "--host", "127.0.0.1", "--port", "8000", "--log-level", "error"],
        cwd=project_root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(3)
    h = check_url("http://127.0.0.1:8000/api/health")
    print(f"  Backend: {'OK (200)' if h == 200 else f'FAIL ({h})'}")

    # Start frontend
    print("Starting frontend...")
    frontend_proc = subprocess.Popen(
        ["npx", "vite", "--port", "5173", "--strictPort"],
        cwd=os.path.join(project_root, "web"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(5)
    for port in [5173, 5174, 5175]:
        h = check_url(f"http://localhost:{port}")
        if h == 200:
            print(f"  Frontend: OK on :{port}")
            break
    else:
        print("  Frontend: FAIL (no port found)")

    print("\nServers running. Press Ctrl+C to stop.")
    while True:
        time.sleep(1)

except KeyboardInterrupt:
    print("\nStopping servers...")
finally:
    for p in [backend_proc, frontend_proc]:
        if p: p.terminate(); p.wait()
    print("Done.")
