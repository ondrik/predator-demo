/* predator-args: oom */
#include <stdlib.h>
#include <string.h>

struct buffer {
    char *data;
    size_t len;
};

struct buffer *buffer_new(size_t len)
{
    struct buffer *b = malloc(sizeof *b);
    if (!b)
        return NULL;
    b->data = malloc(len);
    if (!b->data)
        return NULL;
    b->len = len;
    memset(b->data, 0, len);
    return b;
}

void buffer_free(struct buffer *b)
{
    free(b->data);
    free(b);
}

int main(void)
{
    struct buffer *b = buffer_new(64);
    if (!b)
        return 1;
    b->data[0] = 'x';
    buffer_free(b);
    return 0;
}
