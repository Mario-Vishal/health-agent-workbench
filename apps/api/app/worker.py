import time


def main() -> None:
    while True:
        print("worker heartbeat: demo queue idle", flush=True)
        time.sleep(60)


if __name__ == "__main__":
    main()

