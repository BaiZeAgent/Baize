---
name: system
description: 系统信息查询，包括CPU、内存、磁盘等
when_to_use: 系统 配置 内存 CPU 磁盘 信息 system info
metadata: {"openclaw":{"requires":{"bins":["systeminfo","uname","free","df"]}}}
---

# System

查询系统信息。

## When to Use

✅ **USE this skill when:**

- "系统信息"
- "查看内存"
- "CPU使用率"
- "磁盘空间"
- "系统配置"

## Commands

### 查看系统信息 (Windows)

```bash
systeminfo
```

### 查看系统信息 (Linux/macOS)

```bash
uname -a
```

### 查看内存 (Linux)

```bash
free -h
```

### 查看磁盘 (Linux/macOS)

```bash
df -h
```

### 查看CPU信息 (Linux)

```bash
cat /proc/cpuinfo | head -20
```

### 查看进程

```bash
ps aux | head -20
```

## Notes

- 根据操作系统选择合适的命令
- Windows 使用 systeminfo
- Linux/macOS 使用 uname/free/df
