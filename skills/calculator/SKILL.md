---
name: calculator
description: 计算器，执行数学计算
when_to_use: 计算 算术 数学 加减乘除 calculator
metadata: {"openclaw":{"requires":{"bins":["bc","python"]}}}
---

# Calculator

执行数学计算。

## When to Use

✅ **USE this skill when:**

- "计算一下"
- "帮我算"
- "多少乘多少"
- "数学计算"

## Commands

### 使用 bc 计算

```bash
echo "2+2" | bc
```

### 复杂计算

```bash
echo "scale=2; 100/3" | bc
```

### 使用 Python 计算

```bash
python3 -c "print(2**10)"
```

### 科学计算

```bash
python3 -c "import math; print(math.sqrt(2))"
```

## Examples

**"计算 123 乘以 456"**

```bash
echo "123*456" | bc
```

**"100 除以 3 保留两位小数"**

```bash
echo "scale=2; 100/3" | bc
```

## Notes

- bc 适合简单计算
- Python 适合复杂计算
- scale 设置小数位数
