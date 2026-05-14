#!/usr/bin/env python3
"""Generate cleanup SQL to remove benchmark users."""

import argparse


def main():
    parser = argparse.ArgumentParser(description="Generate benchmark cleanup SQL")
    parser.add_argument("--start-id", type=int, default=1000, help="Starting user ID")
    parser.add_argument("--room-id", type=int, required=True, help="Target room ID")
    parser.add_argument("--count", type=int, default=100, help="Number of users")
    args = parser.parse_args()

    ids = ", ".join(str(args.start_id + i) for i in range(args.count))

    print("-- Cleanup benchmark users: user_0 .. user_{}".format(args.count - 1))
    print()
    print(f"DELETE FROM room_members WHERE room_id = {args.room_id} AND user_id IN ({ids});")
    print(f"DELETE FROM users WHERE id IN ({ids});")
    print(f"DELETE FROM participants WHERE id IN ({ids}) AND kind = 1;")
    print()
    print("-- Verify")
    print(f"SELECT COUNT(*) FROM room_members WHERE room_id = {args.room_id};")


if __name__ == "__main__":
    main()
